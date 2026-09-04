import { posix as path } from 'node:path';
import type { FileSystemEntry } from '@shared/models/file-system-entry';
import {
  createLocalProviderPath,
  type LocalProviderPath,
  type ProviderPath,
} from '@shared/models/provider-path';
import type {
  DeleteOptions,
  FileSystemProvider,
  ProviderOperationOptions,
  WriteOptions,
} from '@shared/providers/file-system-provider';
import type { ProviderCapabilities } from '@shared/providers/provider-capabilities';
import {
  ProviderError,
  providerErrorCodes,
  type ProviderErrorCode,
  type ProviderOperation,
} from '@shared/providers/provider-error';
import type { ProviderConnectionState } from '@shared/providers/provider-session';

interface FakeDirectoryNode {
  readonly kind: 'directory';
  readonly modifiedAt: string;
}

interface FakeFileNode {
  readonly content: Uint8Array;
  readonly kind: 'file';
  readonly modifiedAt: string;
}

type FakeNode = FakeDirectoryNode | FakeFileNode;

const fakeProviderCapabilities: ProviderCapabilities = Object.freeze({
  atomicRename: true,
  checksum: false,
  createDirectory: true,
  delete: true,
  modificationTime: true,
  multipartUpload: false,
  permissions: false,
  read: true,
  rename: true,
  resumeRead: false,
  resumeWrite: false,
  serverSideCopy: false,
  symbolicLinks: false,
  trueDirectories: true,
  write: true,
});

const createProviderError = (
  code: ProviderErrorCode,
  operation: ProviderOperation,
): ProviderError =>
  new ProviderError(code, {
    operation,
    provider: 'local',
  });

const throwIfAborted = (signal: AbortSignal | undefined, operation: ProviderOperation): void => {
  if (signal?.aborted === true) {
    throw createProviderError(providerErrorCodes.cancelled, operation);
  }
};

const concatChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const content = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return content;
};

export class FakeProvider implements FileSystemProvider {
  public readonly capabilities = fakeProviderCapabilities;
  public readonly kind = 'local' as const;

  private state: ProviderConnectionState = 'disconnected';
  private readonly nodes = new Map<string, FakeNode>();

  public constructor() {
    this.nodes.set('/', {
      kind: 'directory',
      modifiedAt: new Date(0).toISOString(),
    });
  }

  public get connectionState(): ProviderConnectionState {
    return this.state;
  }

  public async connect(options?: ProviderOperationOptions): Promise<void> {
    throwIfAborted(options?.signal, 'connect');
    this.state = 'connecting';
    this.state = 'connected';
  }

  public async disconnect(): Promise<void> {
    this.state = 'disconnecting';
    this.state = 'disconnected';
  }

  public async list(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<readonly FileSystemEntry[]> {
    this.ensureConnected('list');
    throwIfAborted(options?.signal, 'list');
    const normalizedPath = this.normalizePath(providerPath, 'list');
    const node = this.getNode(normalizedPath, 'list');

    if (node.kind !== 'directory') {
      throw createProviderError(providerErrorCodes.invalidPath, 'list');
    }

    const entries: FileSystemEntry[] = [];

    for (const [candidatePath, candidateNode] of this.nodes) {
      throwIfAborted(options?.signal, 'list');

      if (candidatePath !== normalizedPath && path.dirname(candidatePath) === normalizedPath) {
        entries.push(this.toEntry(candidatePath, candidateNode));
      }
    }

    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async stat(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<FileSystemEntry> {
    this.ensureConnected('stat');
    throwIfAborted(options?.signal, 'stat');
    const normalizedPath = this.normalizePath(providerPath, 'stat');
    return this.toEntry(normalizedPath, this.getNode(normalizedPath, 'stat'));
  }

  public async createDirectory(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<void> {
    this.ensureConnected('create-directory');
    throwIfAborted(options?.signal, 'create-directory');
    const normalizedPath = this.normalizePath(providerPath, 'create-directory');
    this.ensureDestinationAvailable(normalizedPath, 'create-directory');
    this.ensureParentDirectory(normalizedPath, 'create-directory');
    this.nodes.set(normalizedPath, {
      kind: 'directory',
      modifiedAt: new Date().toISOString(),
    });
  }

  public async delete(providerPath: ProviderPath, options: DeleteOptions): Promise<void> {
    this.ensureConnected('delete');
    throwIfAborted(options.signal, 'delete');
    const normalizedPath = this.normalizePath(providerPath, 'delete');

    if (normalizedPath === '/') {
      throw createProviderError(providerErrorCodes.invalidPath, 'delete');
    }

    const node = this.getNode(normalizedPath, 'delete');
    const descendantPaths = [...this.nodes.keys()].filter((candidatePath) =>
      candidatePath.startsWith(`${normalizedPath}/`),
    );

    if (node.kind === 'directory' && !options.recursive && descendantPaths.length > 0) {
      throw createProviderError(providerErrorCodes.conflict, 'delete');
    }

    for (const descendantPath of descendantPaths.sort(
      (left, right) => right.length - left.length,
    )) {
      throwIfAborted(options.signal, 'delete');
      this.nodes.delete(descendantPath);
    }

    this.nodes.delete(normalizedPath);
  }

  public async rename(
    source: ProviderPath,
    destination: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<void> {
    this.ensureConnected('rename');
    throwIfAborted(options?.signal, 'rename');
    const sourcePath = this.normalizePath(source, 'rename');
    const destinationPath = this.normalizePath(destination, 'rename');

    if (sourcePath === '/' || destinationPath.startsWith(`${sourcePath}/`)) {
      throw createProviderError(providerErrorCodes.invalidPath, 'rename');
    }

    this.getNode(sourcePath, 'rename');
    this.ensureDestinationAvailable(destinationPath, 'rename');
    this.ensureParentDirectory(destinationPath, 'rename');
    const movedNodes = [...this.nodes.entries()]
      .filter(
        ([candidatePath]) =>
          candidatePath === sourcePath || candidatePath.startsWith(`${sourcePath}/`),
      )
      .sort(([leftPath], [rightPath]) => leftPath.length - rightPath.length);

    for (const [candidatePath] of movedNodes) {
      this.nodes.delete(candidatePath);
    }

    for (const [candidatePath, candidateNode] of movedNodes) {
      const suffix = candidatePath.slice(sourcePath.length);
      this.nodes.set(`${destinationPath}${suffix}`, candidateNode);
    }
  }

  public async openRead(
    providerPath: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    this.ensureConnected('read');
    throwIfAborted(options?.signal, 'read');
    const normalizedPath = this.normalizePath(providerPath, 'read');
    const node = this.getNode(normalizedPath, 'read');

    if (node.kind !== 'file') {
      throw createProviderError(providerErrorCodes.invalidPath, 'read');
    }

    const content = node.content.slice();

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(content);
        controller.close();
      },
    });
  }

  public async openWrite(
    providerPath: ProviderPath,
    options: WriteOptions,
  ): Promise<WritableStream<Uint8Array>> {
    this.ensureConnected('write');
    throwIfAborted(options.signal, 'write');
    const normalizedPath = this.normalizePath(providerPath, 'write');
    const existingNode = this.nodes.get(normalizedPath);

    if (existingNode !== undefined && !options.overwrite) {
      throw createProviderError(providerErrorCodes.conflict, 'write');
    }

    if (existingNode?.kind === 'directory') {
      throw createProviderError(providerErrorCodes.invalidPath, 'write');
    }

    this.ensureParentDirectory(normalizedPath, 'write');
    const chunks: Uint8Array[] = [];

    return new WritableStream<Uint8Array>({
      close: () => {
        this.nodes.set(normalizedPath, {
          content: concatChunks(chunks),
          kind: 'file',
          modifiedAt: new Date().toISOString(),
        });
      },
      write: (chunk) => {
        throwIfAborted(options.signal, 'write');
        chunks.push(chunk.slice());
      },
    });
  }

  private ensureConnected(operation: ProviderOperation): void {
    if (this.state !== 'connected') {
      throw createProviderError(providerErrorCodes.notConnected, operation);
    }
  }

  private normalizePath(providerPath: ProviderPath, operation: ProviderOperation): string {
    if (providerPath.provider !== 'local' || !providerPath.path.startsWith('/')) {
      throw createProviderError(providerErrorCodes.invalidPath, operation);
    }

    return path.normalize(providerPath.path);
  }

  private getNode(normalizedPath: string, operation: ProviderOperation): FakeNode {
    const node = this.nodes.get(normalizedPath);

    if (node === undefined) {
      throw createProviderError(providerErrorCodes.notFound, operation);
    }

    return node;
  }

  private ensureDestinationAvailable(normalizedPath: string, operation: ProviderOperation): void {
    if (this.nodes.has(normalizedPath)) {
      throw createProviderError(providerErrorCodes.conflict, operation);
    }
  }

  private ensureParentDirectory(normalizedPath: string, operation: ProviderOperation): void {
    const parentNode = this.nodes.get(path.dirname(normalizedPath));

    if (parentNode === undefined) {
      throw createProviderError(providerErrorCodes.notFound, operation);
    }

    if (parentNode.kind !== 'directory') {
      throw createProviderError(providerErrorCodes.invalidPath, operation);
    }
  }

  private toEntry(normalizedPath: string, node: FakeNode): FileSystemEntry {
    const providerPath: LocalProviderPath = createLocalProviderPath(normalizedPath);

    return {
      kind: node.kind,
      modifiedAt: node.modifiedAt,
      name: normalizedPath === '/' ? '/' : path.basename(normalizedPath),
      path: providerPath,
      size: node.kind === 'file' ? BigInt(node.content.byteLength) : 0n,
    };
  }
}
