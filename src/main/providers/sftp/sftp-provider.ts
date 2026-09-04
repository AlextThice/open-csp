import { posix } from 'node:path';
import type { SFTPWrapper, Stats, FileEntry } from 'ssh2';
import type { FileSystemEntry } from '@shared/models/file-system-entry';
import { createSftpProviderPath, type ProviderPath } from '@shared/models/provider-path';
import type {
  DeleteOptions,
  FileSystemProvider,
  ProviderOperationOptions,
  RenameOptions,
  WriteOptions,
} from '@shared/providers/file-system-provider';
import {
  ProviderError,
  providerErrorCodes,
  type ProviderOperation,
} from '@shared/providers/provider-error';
import { SftpConnection } from './sftp-connection';

const failure = (
  code: (typeof providerErrorCodes)[keyof typeof providerErrorCodes],
  operation: ProviderOperation,
) => new ProviderError(code, { provider: 'sftp', operation });
export const normalizeSftpError = (error: unknown, operation: ProviderOperation): ProviderError => {
  if (error instanceof ProviderError) return error;
  const nativeCode: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  const code =
    nativeCode === 2
      ? providerErrorCodes.notFound
      : nativeCode === 3
        ? providerErrorCodes.accessDenied
        : nativeCode === 8
          ? providerErrorCodes.unsupported
          : nativeCode === 'PROVIDER_NOT_CONNECTED'
            ? providerErrorCodes.notConnected
            : providerErrorCodes.ioError;
  return new ProviderError(
    code,
    {
      provider: 'sftp',
      operation,
      ...(nativeCode === undefined ? {} : { code: String(nativeCode) }),
    },
    { cause: error },
  );
};

export class SftpProvider implements FileSystemProvider {
  public readonly kind = 'sftp' as const;
  public readonly capabilities = Object.freeze({
    atomicRename: true,
    checksum: false,
    createDirectory: true,
    delete: true,
    modificationTime: true,
    multipartUpload: false,
    permissions: true,
    read: true,
    rename: true,
    resumeRead: true,
    resumeWrite: true,
    serverSideCopy: false,
    symbolicLinks: true,
    trueDirectories: true,
    write: true,
  });
  private activeRequests = 0;
  private readonly waiting: (() => void)[] = [];
  public constructor(public readonly connection: SftpConnection) {}
  public get connectionState() {
    return this.connection.state;
  }
  public async connect(options?: ProviderOperationOptions): Promise<void> {
    this.checkAbort(options, 'connect');
    await this.connection.connect();
  }
  public async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  private checkAbort(
    options: ProviderOperationOptions | undefined,
    operation: ProviderOperation,
  ): void {
    if (options?.signal?.aborted) throw failure(providerErrorCodes.cancelled, operation);
  }
  private path(path: ProviderPath): string {
    if (path.provider !== 'sftp' || !path.path.startsWith('/') || path.path.includes('\0'))
      throw failure(providerErrorCodes.invalidPath, 'stat');
    return posix.normalize(path.path);
  }
  private async call<T>(
    operation: ProviderOperation,
    action: (
      channel: SFTPWrapper,
      callback: (error: Error | undefined | null, value: T) => void,
    ) => void,
    options?: ProviderOperationOptions,
    channel?: SFTPWrapper,
  ): Promise<T> {
    this.checkAbort(options, operation);
    if (this.activeRequests >= 8) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.activeRequests += 1;
    try {
      this.checkAbort(options, operation);
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.connection.disconnect();
          reject(failure(providerErrorCodes.ioError, operation));
        }, this.connection.profile.timeout ?? 20000);
        try {
          action(channel ?? this.connection.control(), (error, value) => {
            clearTimeout(timer);
            if (options?.signal?.aborted) reject(failure(providerErrorCodes.cancelled, operation));
            else if (error) reject(normalizeSftpError(error, operation));
            else resolve(value);
          });
        } catch (error) {
          clearTimeout(timer);
          reject(normalizeSftpError(error, operation));
        }
      });
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeRequests -= 1;
    }
  }
  private entry(path: string, stats: Stats): FileSystemEntry {
    return {
      path: createSftpProviderPath(path),
      name: posix.basename(path) || '/',
      kind: stats.isDirectory()
        ? 'directory'
        : stats.isSymbolicLink()
          ? 'symbolic-link'
          : stats.isFile()
            ? 'file'
            : 'special',
      size: BigInt(stats.size),
      modifiedAt: new Date(stats.mtime * 1000).toISOString(),
      permissions: stats.mode,
    };
  }
  public async stat(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<FileSystemEntry> {
    const resolved = this.path(path);
    return this.entry(
      resolved,
      await this.call<Stats>('stat', (sftp, done) => sftp.lstat(resolved, done), options),
    );
  }
  public async list(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<readonly FileSystemEntry[]> {
    const resolved = this.path(path);
    const handle = await this.call<Buffer>(
      'list',
      (sftp, done) => sftp.opendir(resolved, done),
      options,
    );
    const entries: FileSystemEntry[] = [];
    try {
      while (true) {
        const batch = await this.call<FileEntry[] | false>(
          'list',
          (sftp, done) =>
            sftp.readdir(handle, (error, entries) =>
              (error as (Error & { code?: number }) | undefined)?.code === 1
                ? done(null, false)
                : done(error, entries),
            ),
          options,
        );
        if (batch === false || batch.length === 0) break;
        for (const item of batch) {
          if (item.filename === '.' || item.filename === '..') continue;
          if (item.filename.includes('/') || item.filename.includes('\0'))
            throw failure(providerErrorCodes.invalidPath, 'list');
          entries.push(this.entry(posix.join(resolved, item.filename), item.attrs as Stats));
        }
      }
      return entries;
    } finally {
      await this.call<undefined>('list', (sftp, done) =>
        sftp.close(handle, (error) => done(error, undefined)),
      ).catch(() => undefined);
    }
  }
  private async exists(path: ProviderPath): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error instanceof ProviderError && error.code === providerErrorCodes.notFound)
        return false;
      throw error;
    }
  }
  public async createDirectory(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<void> {
    if (await this.exists(path)) throw failure(providerErrorCodes.conflict, 'create-directory');
    await this.call<undefined>(
      'create-directory',
      (sftp, done) => sftp.mkdir(this.path(path), (error) => done(error, undefined)),
      options,
    );
  }
  public async delete(path: ProviderPath, options: DeleteOptions): Promise<void> {
    if (this.path(path) === '/') throw failure(providerErrorCodes.invalidPath, 'delete');
    const entry = await this.stat(path, options);
    if (entry.kind === 'directory') {
      const children = await this.list(path, options);
      if (!options.recursive && children.length > 0)
        throw failure(providerErrorCodes.conflict, 'delete');
      for (const child of children) await this.delete(child.path, options);
      await this.call<undefined>(
        'delete',
        (sftp, done) => sftp.rmdir(this.path(path), (error) => done(error, undefined)),
        options,
      );
    } else
      await this.call<undefined>(
        'delete',
        (sftp, done) => sftp.unlink(this.path(path), (error) => done(error, undefined)),
        options,
      );
  }
  public async rename(
    source: ProviderPath,
    destination: ProviderPath,
    options?: RenameOptions,
  ): Promise<void> {
    const from = this.path(source);
    const to = this.path(destination);
    if (from === '/' || to === '/' || to === from || to.startsWith(`${from}/`))
      throw failure(providerErrorCodes.invalidPath, 'rename');
    if (options?.overwrite) {
      await this.replace(source, destination);
      return;
    }
    if (await this.exists(destination)) throw failure(providerErrorCodes.conflict, 'rename');
    await this.call<undefined>(
      'rename',
      (sftp, done) => sftp.rename(from, to, (error) => done(error, undefined)),
      options,
    );
  }
  public async replace(source: ProviderPath, destination: ProviderPath): Promise<void> {
    await this.call<undefined>('rename', (sftp, done) =>
      sftp.ext_openssh_rename(this.path(source), this.path(destination), (error) =>
        done(error, undefined),
      ),
    );
  }
  private offset(options?: ProviderOperationOptions): number {
    const offset = options?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw failure(providerErrorCodes.invalidPath, 'read');
    return offset;
  }
  public async openRead(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    this.checkAbort(options, 'read');
    let position = this.offset(options);
    if ((await this.stat(path, options)).kind !== 'file')
      throw failure(providerErrorCodes.unsupported, 'read');
    const channel = await this.connection.data();
    const handle = await this.call<Buffer>(
      'read',
      (sftp, done) => sftp.open(this.path(path), 'r', done),
      options,
      channel,
    );
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await this.call<undefined>(
          'read',
          (sftp, done) => sftp.close(handle, (error) => done(error, undefined)),
          undefined,
          channel,
        ).catch(() => undefined);
      }
    };
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            const buffer = Buffer.alloc(65536);
            const length = await this.call<number>(
              'read',
              (sftp, done) =>
                sftp.read(handle, buffer, 0, buffer.length, position, (error, bytes) =>
                  done(error, bytes),
                ),
              options,
              channel,
            );
            if (length === 0) {
              await close();
              controller.close();
            } else {
              position += length;
              controller.enqueue(buffer.subarray(0, length));
            }
          } catch (error) {
            await close();
            controller.error(error);
          }
        },
        cancel: close,
      },
      { highWaterMark: 1 },
    );
  }
  public async openWrite(
    path: ProviderPath,
    options: WriteOptions,
  ): Promise<WritableStream<Uint8Array>> {
    this.checkAbort(options, 'write');
    const channel = await this.connection.data();
    let position = this.offset(options);
    if (position > 0 && !options.overwrite) throw failure(providerErrorCodes.invalidPath, 'write');
    const handle = await this.call<Buffer>(
      'write',
      (sftp, done) =>
        sftp.open(this.path(path), position > 0 ? 'r+' : options.overwrite ? 'w' : 'wx', done),
      options,
      channel,
    );
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await this.call<undefined>(
          'write',
          (sftp, done) => sftp.close(handle, (error) => done(error, undefined)),
          undefined,
          channel,
        );
      }
    };
    return new WritableStream<Uint8Array>(
      {
        write: async (chunk) => {
          try {
            for (let offset = 0; offset < chunk.length; offset += 65536) {
              const buffer = Buffer.from(chunk.subarray(offset, offset + 65536));
              await this.call<undefined>(
                'write',
                (sftp, done) =>
                  sftp.write(handle, buffer, 0, buffer.length, position, (error) =>
                    done(error, undefined),
                  ),
                options,
                channel,
              );
              position += buffer.length;
            }
          } catch (error) {
            await close().catch(() => undefined);
            throw error;
          }
        },
        close,
        abort: () => close().catch(() => undefined),
      },
      { highWaterMark: 1 },
    );
  }
}
