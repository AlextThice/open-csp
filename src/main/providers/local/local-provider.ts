import type { BigIntStats } from 'node:fs';
import {
  lstat,
  mkdir,
  open as openFile,
  readdir,
  realpath,
  rename as renameEntry,
  rmdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileSystemEntry, FileSystemEntryKind } from '@shared/models/file-system-entry';
import {
  createLocalProviderPath,
  type LocalProviderPath,
  type ProviderPath,
} from '@shared/models/provider-path';
import type {
  DeleteOptions,
  FileSystemProvider,
  ProviderOperationOptions,
  RenameOptions,
  WriteOptions,
} from '@shared/providers/file-system-provider';
import type { ProviderCapabilities } from '@shared/providers/provider-capabilities';
import { providerErrorCodes, type ProviderOperation } from '@shared/providers/provider-error';
import type { ProviderConnectionState } from '@shared/providers/provider-session';
import {
  createLocalProviderError,
  normalizeLocalProviderError,
  throwIfLocalOperationAborted,
} from './local-provider-error';

export interface LocalProviderOptions {
  readonly rootPath: string;
}

const readChunkSize = 64 * 1024;

const isPathWithinRoot = (relativePath: string): boolean =>
  relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);

const localProviderCapabilities: ProviderCapabilities = Object.freeze({
  atomicRename: true,
  checksum: false,
  createDirectory: true,
  delete: true,
  modificationTime: true,
  multipartUpload: false,
  permissions: process.platform !== 'win32',
  read: true,
  rename: true,
  resumeRead: true,
  resumeWrite: true,
  serverSideCopy: false,
  symbolicLinks: true,
  trueDirectories: true,
  write: true,
});

const getEntryKind = (stats: BigIntStats): FileSystemEntryKind => {
  if (stats.isDirectory()) {
    return 'directory';
  }

  if (stats.isFile()) {
    return 'file';
  }

  if (stats.isSymbolicLink()) {
    return 'symbolic-link';
  }

  return 'special';
};

const closeFileHandle = async (
  fileHandle: FileHandle,
  isClosed: { value: boolean },
): Promise<void> => {
  if (!isClosed.value) {
    isClosed.value = true;
    await fileHandle.close();
  }
};

export class LocalProvider implements FileSystemProvider {
  public readonly capabilities = localProviderCapabilities;
  public readonly kind = 'local' as const;

  private readonly configuredRootPath: string;
  private activeRootPath: string | undefined;
  private state: ProviderConnectionState = 'disconnected';

  public constructor(options: LocalProviderOptions) {
    this.configuredRootPath = resolve(options.rootPath);
  }

  public get connectionState(): ProviderConnectionState {
    return this.state;
  }

  public get rootPath(): LocalProviderPath {
    return createLocalProviderPath(this.configuredRootPath);
  }

  public async connect(options?: ProviderOperationOptions): Promise<void> {
    if (this.state === 'connected') {
      return;
    }

    this.state = 'connecting';

    try {
      throwIfLocalOperationAborted(options?.signal, 'connect');
      const resolvedRootPath = await realpath(this.configuredRootPath);
      const rootStats = await lstat(resolvedRootPath);

      if (!rootStats.isDirectory()) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, 'connect');
      }

      throwIfLocalOperationAborted(options?.signal, 'connect');
      this.activeRootPath = resolvedRootPath;
      this.state = 'connected';
    } catch (error: unknown) {
      this.activeRootPath = undefined;
      this.state = 'failed';
      throw normalizeLocalProviderError(error, 'connect');
    }
  }

  public async disconnect(): Promise<void> {
    if (this.state === 'disconnected') {
      return;
    }

    this.state = 'disconnecting';
    this.activeRootPath = undefined;
    this.state = 'disconnected';
  }

  public async list(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<readonly FileSystemEntry[]> {
    const operation = 'list' as const;

    try {
      throwIfLocalOperationAborted(options?.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);
      await this.assertNoSymbolicLinkAncestors(resolvedPath, true, operation, options?.signal);
      const directoryStats = await lstat(resolvedPath, { bigint: true });

      if (!directoryStats.isDirectory()) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      const directoryEntries = await readdir(resolvedPath, { withFileTypes: true });
      const entries: FileSystemEntry[] = [];

      for (const directoryEntry of directoryEntries) {
        throwIfLocalOperationAborted(options?.signal, operation);
        const entryPath = join(resolvedPath, directoryEntry.name);

        try {
          const entryStats = await lstat(entryPath, { bigint: true });
          entries.push(this.toEntry(entryPath, entryStats));
        } catch (error: unknown) {
          const normalizedError = normalizeLocalProviderError(error, operation);

          if (
            normalizedError.code !== providerErrorCodes.accessDenied &&
            normalizedError.code !== providerErrorCodes.notFound &&
            normalizedError.code !== providerErrorCodes.invalidPath
          ) {
            throw normalizedError;
          }
        }
      }

      return entries.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async stat(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<FileSystemEntry> {
    const operation = 'stat' as const;

    try {
      throwIfLocalOperationAborted(options?.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);
      await this.assertNoSymbolicLinkAncestors(resolvedPath, false, operation, options?.signal);
      const stats = await lstat(resolvedPath, { bigint: true });
      return this.toEntry(resolvedPath, stats);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async createDirectory(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<void> {
    const operation = 'create-directory' as const;

    try {
      throwIfLocalOperationAborted(options?.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);
      await this.assertNoSymbolicLinkAncestors(resolvedPath, false, operation, options?.signal);
      await mkdir(resolvedPath);
      throwIfLocalOperationAborted(options?.signal, operation);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async delete(providerPath: ProviderPath, options: DeleteOptions): Promise<void> {
    const operation = 'delete' as const;

    try {
      throwIfLocalOperationAborted(options.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);

      if (resolvedPath === this.requireConnectedRoot(operation)) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      await this.assertNoSymbolicLinkAncestors(resolvedPath, false, operation, options.signal);
      await this.deleteResolvedEntry(resolvedPath, options.recursive, options.signal);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async rename(
    source: ProviderPath,
    destination: ProviderPath,
    options?: RenameOptions,
  ): Promise<void> {
    const operation = 'rename' as const;

    try {
      throwIfLocalOperationAborted(options?.signal, operation);
      const sourcePath = this.resolveProviderPath(source, operation);
      const destinationPath = this.resolveProviderPath(destination, operation);
      const rootPath = this.requireConnectedRoot(operation);

      if (sourcePath === rootPath || destinationPath === rootPath) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      const destinationRelativeToSource = relative(sourcePath, destinationPath);

      if (
        destinationRelativeToSource === '' ||
        (!destinationRelativeToSource.startsWith(`..${sep}`) &&
          destinationRelativeToSource !== '..' &&
          !isAbsolute(destinationRelativeToSource))
      ) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      await this.assertNoSymbolicLinkAncestors(sourcePath, false, operation, options?.signal);
      await this.assertNoSymbolicLinkAncestors(destinationPath, false, operation, options?.signal);
      await lstat(sourcePath);
      if (!options?.overwrite) await this.assertDestinationDoesNotExist(destinationPath, operation);
      const destinationParentStats = await lstat(dirname(destinationPath));

      if (!destinationParentStats.isDirectory()) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      await renameEntry(sourcePath, destinationPath);
      throwIfLocalOperationAborted(options?.signal, operation);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async openRead(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const operation = 'read' as const;

    try {
      throwIfLocalOperationAborted(options?.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);
      await this.assertNoSymbolicLinkAncestors(resolvedPath, true, operation, options?.signal);
      const stats = await lstat(resolvedPath);

      if (!stats.isFile()) {
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      }

      const offset = this.streamOffset(options);
      const fileHandle = await openFile(resolvedPath, 'r');
      return this.createReadStream(fileHandle, options?.signal, offset);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  public async openWrite(
    providerPath: ProviderPath,
    options: WriteOptions,
  ): Promise<WritableStream<Uint8Array>> {
    const operation = 'write' as const;

    try {
      throwIfLocalOperationAborted(options.signal, operation);
      const resolvedPath = this.resolveProviderPath(providerPath, operation);
      await this.assertNoSymbolicLinkAncestors(resolvedPath, true, operation, options.signal);
      const offset = this.streamOffset(options);
      if (offset > 0 && !options.overwrite)
        throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
      const fileHandle = await openFile(
        resolvedPath,
        offset > 0 ? 'r+' : options.overwrite ? 'w' : 'wx',
      );
      return this.createWriteStream(fileHandle, options.signal, offset);
    } catch (error: unknown) {
      throw normalizeLocalProviderError(error, operation);
    }
  }

  private streamOffset(options?: ProviderOperationOptions): number {
    const offset = options?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw createLocalProviderError(providerErrorCodes.invalidPath, 'read');
    return offset;
  }

  private requireConnectedRoot(operation: ProviderOperation): string {
    if (this.state !== 'connected' || this.activeRootPath === undefined) {
      throw createLocalProviderError(providerErrorCodes.notConnected, operation);
    }

    return this.activeRootPath;
  }

  private resolveProviderPath(providerPath: ProviderPath, operation: ProviderOperation): string {
    const rootPath = this.requireConnectedRoot(operation);

    if (providerPath.provider !== 'local' || !isAbsolute(providerPath.path)) {
      throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
    }

    const resolvedPath = resolve(providerPath.path);
    const activeRelativePath = relative(rootPath, resolvedPath);

    if (isPathWithinRoot(activeRelativePath)) {
      return resolvedPath;
    }

    const configuredRelativePath = relative(this.configuredRootPath, resolvedPath);

    if (!isPathWithinRoot(configuredRelativePath)) {
      throw createLocalProviderError(providerErrorCodes.invalidPath, operation);
    }

    return resolve(rootPath, configuredRelativePath);
  }

  private async assertNoSymbolicLinkAncestors(
    resolvedPath: string,
    includeTarget: boolean,
    operation: ProviderOperation,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const rootPath = this.requireConnectedRoot(operation);
    const relativePath = relative(rootPath, resolvedPath);

    if (relativePath === '') {
      return;
    }

    const segments = relativePath.split(sep).filter((segment) => segment.length > 0);
    const segmentCount = includeTarget ? segments.length : Math.max(segments.length - 1, 0);
    let candidatePath = rootPath;

    for (const segment of segments.slice(0, segmentCount)) {
      throwIfLocalOperationAborted(signal, operation);
      candidatePath = join(candidatePath, segment);

      try {
        const stats = await lstat(candidatePath);

        if (stats.isSymbolicLink()) {
          throw createLocalProviderError(providerErrorCodes.unsupported, operation);
        }
      } catch (error: unknown) {
        const normalizedError = normalizeLocalProviderError(error, operation);

        if (normalizedError.code === providerErrorCodes.notFound) {
          return;
        }

        throw normalizedError;
      }
    }
  }

  private async assertDestinationDoesNotExist(
    destinationPath: string,
    operation: ProviderOperation,
  ): Promise<void> {
    try {
      await lstat(destinationPath);
      throw createLocalProviderError(providerErrorCodes.conflict, operation);
    } catch (error: unknown) {
      const normalizedError = normalizeLocalProviderError(error, operation);

      if (normalizedError.code !== providerErrorCodes.notFound) {
        throw normalizedError;
      }
    }
  }

  private async deleteResolvedEntry(
    resolvedPath: string,
    recursive: boolean,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    throwIfLocalOperationAborted(signal, 'delete');
    const stats = await lstat(resolvedPath);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      await unlink(resolvedPath);
      return;
    }

    if (!recursive) {
      await rmdir(resolvedPath);
      return;
    }

    const entries = await readdir(resolvedPath);

    for (const entry of entries) {
      await this.deleteResolvedEntry(join(resolvedPath, entry), true, signal);
    }

    throwIfLocalOperationAborted(signal, 'delete');
    await rmdir(resolvedPath);
  }

  private toEntry(resolvedPath: string, stats: BigIntStats): FileSystemEntry {
    const rootPath = this.activeRootPath ?? this.configuredRootPath;
    const relativePath = relative(rootPath, resolvedPath);
    const providerPath = isPathWithinRoot(relativePath)
      ? resolve(this.configuredRootPath, relativePath)
      : resolvedPath;

    return {
      kind: getEntryKind(stats),
      modifiedAt: stats.mtime.toISOString(),
      name: basename(resolvedPath) || resolvedPath,
      path: createLocalProviderPath(providerPath),
      permissions: Number(stats.mode),
      size: stats.size,
    };
  }

  private createReadStream(
    fileHandle: FileHandle,
    signal: AbortSignal | undefined,
    offset: number,
  ): ReadableStream<Uint8Array> {
    const isClosed = { value: false };
    let position = offset;
    let controllerReference: ReadableStreamDefaultController<Uint8Array> | undefined;

    const removeAbortListener = (): void => {
      signal?.removeEventListener('abort', abortListener);
    };
    const close = async (): Promise<void> => {
      removeAbortListener();
      await closeFileHandle(fileHandle, isClosed);
    };
    const abortListener = (): void => {
      controllerReference?.error(createLocalProviderError(providerErrorCodes.cancelled, 'read'));
      void close().catch(() => undefined);
    };

    return new ReadableStream<Uint8Array>({
      cancel: close,
      pull: async (controller) => {
        controllerReference = controller;

        try {
          throwIfLocalOperationAborted(signal, 'read');
          const buffer = new Uint8Array(readChunkSize);
          const result = await fileHandle.read(buffer, 0, buffer.byteLength, position);

          if (result.bytesRead === 0) {
            await close();
            controller.close();
            return;
          }

          position += result.bytesRead;
          controller.enqueue(buffer.subarray(0, result.bytesRead));
        } catch (error: unknown) {
          await close();
          controller.error(normalizeLocalProviderError(error, 'read'));
        }
      },
      start: (controller) => {
        controllerReference = controller;
        signal?.addEventListener('abort', abortListener, { once: true });
      },
    });
  }

  private createWriteStream(
    fileHandle: FileHandle,
    signal: AbortSignal | undefined,
    offset: number,
  ): WritableStream<Uint8Array> {
    const isClosed = { value: false };
    let position = offset;
    let controllerReference: WritableStreamDefaultController | undefined;

    const removeAbortListener = (): void => {
      signal?.removeEventListener('abort', abortListener);
    };
    const close = async (): Promise<void> => {
      removeAbortListener();
      await closeFileHandle(fileHandle, isClosed);
    };
    const abortListener = (): void => {
      controllerReference?.error(createLocalProviderError(providerErrorCodes.cancelled, 'write'));
      void close().catch(() => undefined);
    };

    return new WritableStream<Uint8Array>({
      abort: close,
      close,
      start: (controller) => {
        controllerReference = controller;
        signal?.addEventListener('abort', abortListener, { once: true });
      },
      write: async (chunk) => {
        try {
          throwIfLocalOperationAborted(signal, 'write');
          let chunkOffset = 0;

          while (chunkOffset < chunk.byteLength) {
            const result = await fileHandle.write(
              chunk,
              chunkOffset,
              chunk.byteLength - chunkOffset,
              position,
            );
            chunkOffset += result.bytesWritten;
            position += result.bytesWritten;
          }
        } catch (error: unknown) {
          await close();
          throw normalizeLocalProviderError(error, 'write');
        }
      },
    });
  }
}
