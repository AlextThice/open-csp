import { randomUUID } from 'node:crypto';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import type { S3ConnectionProfile } from '@shared/models/connection-profile';
import type { FileSystemEntry } from '@shared/models/file-system-entry';
import {
  createS3ProviderPath,
  type S3ProviderPath,
  type ProviderPath,
} from '@shared/models/provider-path';
import { s3Name, s3Prefix } from '@shared/models/s3-path';
import { s3CredentialsSchema, s3EndpointSchema } from '@shared/models/s3-profile';
import type {
  FileSystemProvider,
  ProviderOperationOptions,
  DeleteOptions,
  RenameOptions,
  WriteOptions,
} from '@shared/providers/file-system-provider';
import type { ProviderConnectionState } from '@shared/providers/provider-session';
import {
  ProviderError,
  providerErrorCodes,
  type ProviderOperation,
} from '@shared/providers/provider-error';
import { applicationErrorCodes } from '@shared/errors/application-error';
import { ApplicationError } from '../../ipc/application-error';
import { normalizeS3Error, s3Failure } from './s3-error';
import { createS3Upload } from './s3-upload';
import type { MultipartJournal } from './multipart-journal';

interface ObjectRecord {
  readonly key: string;
  readonly size: bigint;
  readonly etag: string;
  readonly modifiedAt?: string;
}
interface DeletionPlan {
  readonly path: S3ProviderPath;
  readonly objects: readonly ObjectRecord[];
}
export interface S3ProviderOptions {
  readonly pageSize?: number;
  readonly client?: S3Client;
}

export class S3Provider implements FileSystemProvider {
  public readonly kind = 's3' as const;
  public readonly capabilities = Object.freeze({
    atomicRename: false,
    checksum: true,
    createDirectory: true,
    delete: true,
    modificationTime: true,
    multipartUpload: true,
    permissions: false,
    read: true,
    rename: true,
    resumeRead: true,
    resumeWrite: false,
    serverSideCopy: true,
    symbolicLinks: false,
    trueDirectories: false,
    write: true,
  });
  private state: ProviderConnectionState = 'disconnected';
  private client: S3Client | undefined;
  private connecting: Promise<void> | undefined;
  private generation = 0;
  private lifetime = new AbortController();
  private readonly deletions = new Map<string, DeletionPlan>();
  public constructor(
    public readonly profile: S3ConnectionProfile,
    private readonly credentials: () => Promise<{
      readonly secretAccessKey: string;
      readonly sessionToken?: string;
    }>,
    public readonly journal: MultipartJournal,
    private readonly options: S3ProviderOptions = {},
  ) {}
  public get connectionState(): ProviderConnectionState {
    return this.state;
  }
  public async connect(options?: ProviderOperationOptions): Promise<void> {
    if (options?.signal?.aborted) throw s3Failure(providerErrorCodes.cancelled, 'connect');
    if (this.state === 'connected') return;
    if (this.connecting) return this.connecting;
    const generation = ++this.generation;
    this.lifetime = new AbortController();
    this.state = 'connecting';
    const task = (async () => {
      try {
        if (!s3EndpointSchema.safeParse(this.profile.endpoint ?? '').success)
          throw new ApplicationError(applicationErrorCodes.s3Endpoint);
        if (!this.profile.accessKeyId)
          throw new ApplicationError(applicationErrorCodes.credentialRequired);
        const credentials = s3CredentialsSchema.parse(await this.credentials());
        if (generation !== this.generation)
          throw s3Failure(providerErrorCodes.cancelled, 'connect');
        this.client =
          this.options.client ??
          new S3Client({
            region: this.profile.region,
            ...(this.profile.endpoint ? { endpoint: this.profile.endpoint } : {}),
            forcePathStyle: this.profile.forcePathStyle,
            credentials: {
              accessKeyId: this.profile.accessKeyId,
              secretAccessKey: credentials.secretAccessKey,
              ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
            },
            maxAttempts: 3,
            requestHandler: { connectionTimeout: 10000, socketTimeout: 30000 },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          });
        await this.run('connect', options, (client, signal) =>
          this.profile.bucket
            ? client.send(
                new ListObjectsV2Command({
                  Bucket: this.profile.bucket,
                  Prefix: this.profile.initialPrefix ?? '',
                  MaxKeys: 1,
                }),
                { abortSignal: signal },
              )
            : client.send(new ListBucketsCommand({ MaxBuckets: 1 }), { abortSignal: signal }),
        );
        if (generation !== this.generation)
          throw s3Failure(providerErrorCodes.cancelled, 'connect');
        this.state = 'connected';
      } catch (error) {
        if (generation === this.generation) {
          this.state = 'failed';
          this.client?.destroy();
          this.client = undefined;
        }
        throw normalizeS3Error(error, 'connect');
      }
    })();
    this.connecting = task;
    try {
      await task;
    } finally {
      if (this.connecting === task) this.connecting = undefined;
    }
  }
  public async disconnect(): Promise<void> {
    this.generation += 1;
    this.lifetime.abort();
    this.client?.destroy();
    this.client = undefined;
    this.connecting = undefined;
    this.state = 'disconnected';
    this.deletions.clear();
  }
  public async testConnection(): Promise<void> {
    if (this.state !== 'connected') return this.connect();
    const generation = this.generation;
    try {
      await this.run('connect', undefined, (client, signal) =>
        this.profile.bucket
          ? client.send(
              new ListObjectsV2Command({
                Bucket: this.profile.bucket,
                Prefix: this.profile.initialPrefix ?? '',
                MaxKeys: 1,
              }),
              { abortSignal: signal },
            )
          : client.send(new ListBucketsCommand({ MaxBuckets: 1 }), { abortSignal: signal }),
      );
    } catch (error) {
      if (this.generation === generation) {
        this.state = 'failed';
        this.client?.destroy();
        this.client = undefined;
      }
      throw error;
    }
  }
  private async run<T>(
    operation: ProviderOperation,
    options: ProviderOperationOptions | undefined,
    action: (client: S3Client, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!this.client || (this.state !== 'connected' && operation !== 'connect'))
      throw s3Failure(providerErrorCodes.notConnected, operation);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(operation === 'read' ? [] : [AbortSignal.timeout(30000)]),
      ...(options?.signal ? [options.signal] : []),
    ]);
    if (signal.aborted) throw s3Failure(providerErrorCodes.cancelled, operation);
    try {
      return await action(this.client, signal);
    } catch (error) {
      throw normalizeS3Error(error, operation);
    }
  }
  private path(path: ProviderPath, operation: ProviderOperation): S3ProviderPath {
    if (
      path.provider !== 's3' ||
      (this.profile.bucket && path.bucket !== this.profile.bucket) ||
      (path.bucket !== '' && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(path.bucket)) ||
      Buffer.byteLength(path.key, 'utf8') > 1024 ||
      path.key.includes('\0') ||
      (!path.bucket && path.key)
    )
      throw s3Failure(providerErrorCodes.invalidPath, operation);
    return path;
  }
  private entry(
    path: S3ProviderPath,
    kind: 'bucket' | 'prefix' | 'object',
    size = 0n,
    modifiedAt?: string,
    versionTag?: string,
  ): FileSystemEntry {
    return {
      path,
      kind: kind === 'object' ? 'file' : 'directory',
      s3Kind: kind,
      name: kind === 'bucket' ? path.bucket : s3Name(path.key),
      size,
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(versionTag ? { versionTag } : {}),
    };
  }
  public async list(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<readonly FileSystemEntry[]> {
    const location = this.path(path, 'list');
    const entries: FileSystemEntry[] = [];
    let continuation: string | undefined;
    const seen = new Set<string>();
    do {
      if (!location.bucket) {
        const result = await this.run('list', options, (client, signal) =>
          client.send(
            new ListBucketsCommand({
              MaxBuckets: this.options.pageSize ?? 1000,
              ...(continuation ? { ContinuationToken: continuation } : {}),
            }),
            { abortSignal: signal },
          ),
        );
        for (const bucket of result.Buckets ?? [])
          if (bucket.Name)
            entries.push(
              this.entry(
                createS3ProviderPath(bucket.Name, ''),
                'bucket',
                0n,
                bucket.CreationDate?.toISOString(),
              ),
            );
        continuation = result.ContinuationToken;
      } else {
        const prefix = s3Prefix(location.key);
        const result = await this.run('list', options, (client, signal) =>
          client.send(
            new ListObjectsV2Command({
              Bucket: location.bucket,
              Prefix: prefix,
              Delimiter: '/',
              MaxKeys: this.options.pageSize ?? 1000,
              ...(continuation ? { ContinuationToken: continuation } : {}),
            }),
            { abortSignal: signal },
          ),
        );
        for (const item of result.CommonPrefixes ?? [])
          if (item.Prefix !== undefined)
            entries.push(this.entry(createS3ProviderPath(location.bucket, item.Prefix), 'prefix'));
        for (const item of result.Contents ?? [])
          if (item.Key !== undefined && item.Key !== prefix)
            entries.push(
              this.entry(
                createS3ProviderPath(location.bucket, item.Key),
                'object',
                BigInt(item.Size ?? 0),
                item.LastModified?.toISOString(),
                item.ETag,
              ),
            );
        continuation = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (result.IsTruncated && !continuation)
          throw s3Failure(providerErrorCodes.ioError, 'list');
      }
      if (continuation && seen.has(continuation))
        throw s3Failure(providerErrorCodes.ioError, 'list');
      if (continuation) seen.add(continuation);
    } while (continuation);
    return entries;
  }
  public async stat(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<FileSystemEntry> {
    const location = this.path(path, 'stat');
    if (!location.bucket) {
      await this.run('stat', options, async () => undefined);
      return this.entry(location, 'bucket');
    }
    if (!location.key) {
      await this.run('stat', options, (client, signal) =>
        client.send(new HeadBucketCommand({ Bucket: location.bucket }), { abortSignal: signal }),
      );
      return this.entry(location, 'bucket');
    }
    if (!location.key.endsWith('/')) {
      try {
        const result = await this.run('stat', options, (client, signal) =>
          client.send(new HeadObjectCommand({ Bucket: location.bucket, Key: location.key }), {
            abortSignal: signal,
          }),
        );
        return this.entry(
          location,
          'object',
          BigInt(result.ContentLength ?? 0),
          result.LastModified?.toISOString(),
          result.ETag,
        );
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== providerErrorCodes.notFound)
          throw error;
      }
    }
    const prefix = s3Prefix(location.key);
    const result = await this.run('stat', options, (client, signal) =>
      client.send(
        new ListObjectsV2Command({ Bucket: location.bucket, Prefix: prefix, MaxKeys: 1 }),
        { abortSignal: signal },
      ),
    );
    if (!result.Contents?.length) throw s3Failure(providerErrorCodes.notFound, 'stat');
    return this.entry(createS3ProviderPath(location.bucket, prefix), 'prefix');
  }
  public async createDirectory(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<void> {
    const location = this.path(path, 'create-directory');
    if (!location.bucket || !location.key)
      throw s3Failure(providerErrorCodes.unsupported, 'create-directory');
    try {
      await this.stat(createS3ProviderPath(location.bucket, s3Prefix(location.key)), options);
      throw s3Failure(providerErrorCodes.conflict, 'create-directory');
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== providerErrorCodes.notFound)
        throw error;
    }
    await this.run('create-directory', options, (client, signal) =>
      client.send(
        new PutObjectCommand({
          Bucket: location.bucket,
          Key: s3Prefix(location.key),
          Body: new Uint8Array(),
          IfNoneMatch: '*',
        }),
        { abortSignal: signal },
      ),
    );
  }
  private async objects(
    path: S3ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<readonly ObjectRecord[]> {
    const entry = await this.stat(path, options);
    if (entry.kind === 'file')
      return [
        {
          key: path.key,
          size: entry.size,
          etag: entry.versionTag ?? '',
          ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
        },
      ];
    if (!path.key) throw s3Failure(providerErrorCodes.unsupported, 'delete');
    const records: ObjectRecord[] = [];
    let continuation: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.run('list', options, (client, signal) =>
        client.send(
          new ListObjectsV2Command({
            Bucket: path.bucket,
            Prefix: s3Prefix(path.key),
            MaxKeys: this.options.pageSize ?? 1000,
            ...(continuation ? { ContinuationToken: continuation } : {}),
          }),
          { abortSignal: signal },
        ),
      );
      for (const item of page.Contents ?? [])
        if (item.Key !== undefined)
          records.push({
            key: item.Key,
            size: BigInt(item.Size ?? 0),
            etag: item.ETag ?? '',
            ...(item.LastModified ? { modifiedAt: item.LastModified.toISOString() } : {}),
          });
      continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
      if ((page.IsTruncated && !continuation) || (continuation && seen.has(continuation)))
        throw s3Failure(providerErrorCodes.ioError, 'list');
      if (continuation) seen.add(continuation);
    } while (continuation);
    return records.sort((left, right) => left.key.localeCompare(right.key));
  }
  public async previewDelete(path: ProviderPath) {
    const location = this.path(path, 'delete');
    if (!location.bucket || !location.key)
      throw s3Failure(providerErrorCodes.unsupported, 'delete');
    const objects = await this.objects(location);
    const confirmationId = randomUUID();
    if (this.deletions.size >= 1000) this.deletions.clear();
    this.deletions.set(confirmationId, { path: location, objects });
    return {
      confirmationId,
      count: objects.length,
      bytes: objects.reduce((sum, item) => sum + item.size, 0n),
    };
  }
  public async deleteConfirmed(path: ProviderPath, confirmationId: string): Promise<void> {
    const location = this.path(path, 'delete');
    const plan = this.deletions.get(confirmationId);
    if (!plan || plan.path.bucket !== location.bucket || plan.path.key !== location.key)
      throw s3Failure(providerErrorCodes.conflict, 'delete');
    const current = await this.objects(location);
    if (
      current.length !== plan.objects.length ||
      current.some(
        (item, index) =>
          item.key !== plan.objects[index]?.key ||
          item.etag !== plan.objects[index]?.etag ||
          item.size !== plan.objects[index]?.size,
      )
    )
      throw s3Failure(providerErrorCodes.conflict, 'delete');
    this.deletions.delete(confirmationId);
    await this.deleteObjects(location.bucket, plan.objects);
  }
  private async deleteObjects(
    bucket: string,
    objects: readonly ObjectRecord[],
    options?: ProviderOperationOptions,
  ): Promise<void> {
    for (const item of objects) {
      if (!item.etag) throw s3Failure(providerErrorCodes.unsupported, 'delete');
      const current = await this.run('delete', options, (client, signal) =>
        client.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key, IfMatch: item.etag }), {
          abortSignal: signal,
        }),
      );
      if (current.ETag !== item.etag || BigInt(current.ContentLength ?? 0) !== item.size)
        throw s3Failure(providerErrorCodes.conflict, 'delete');
      await this.run('delete', options, (client, signal) =>
        client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: item.key, IfMatch: item.etag }),
          { abortSignal: signal },
        ),
      );
    }
  }
  public async delete(path: ProviderPath, options: DeleteOptions): Promise<void> {
    const location = this.path(path, 'delete');
    const records = await this.objects(location, options);
    if (
      !options.recursive &&
      records.some((item) => item.key !== location.key && item.key !== s3Prefix(location.key))
    )
      throw s3Failure(providerErrorCodes.conflict, 'delete');
    await this.deleteObjects(location.bucket, records, options);
  }
  public async copy(
    source: ProviderPath,
    destination: ProviderPath,
    options?: RenameOptions,
  ): Promise<void> {
    await this.copyOrRename(source, destination, false, options);
  }
  public async rename(
    source: ProviderPath,
    destination: ProviderPath,
    options?: RenameOptions,
  ): Promise<void> {
    await this.copyOrRename(source, destination, true, options);
  }
  private async copyOrRename(
    source: ProviderPath,
    destination: ProviderPath,
    remove: boolean,
    options?: RenameOptions,
  ): Promise<void> {
    const from = this.path(source, 'rename');
    const to = this.path(destination, 'rename');
    if (
      !from.bucket ||
      !from.key ||
      !to.bucket ||
      !to.key ||
      (from.bucket === to.bucket && (from.key === to.key || to.key.startsWith(s3Prefix(from.key))))
    )
      throw s3Failure(providerErrorCodes.invalidPath, 'rename');
    const sourceEntry = await this.stat(from, options);
    const records = await this.objects(from, options);
    const targets = records.map((item) => ({
      item,
      key:
        sourceEntry.kind === 'directory'
          ? `${s3Prefix(to.key)}${item.key.slice(s3Prefix(from.key).length)}`
          : to.key,
    }));
    for (const { item, key } of targets)
      await this.copyObject(from.bucket, to.bucket, item, key, options);
    if (remove) await this.deleteObjects(from.bucket, records, options);
  }
  private async copyObject(
    sourceBucket: string,
    bucket: string,
    source: ObjectRecord,
    key: string,
    options?: RenameOptions,
  ): Promise<void> {
    const copySource = `${sourceBucket}/${source.key.split('/').map(encodeURIComponent).join('/')}`;
    if (!source.etag) throw s3Failure(providerErrorCodes.unsupported, 'rename');
    if (options?.overwrite && source.size <= 5n * 1024n ** 3n) {
      await this.run('rename', options, (client, signal) =>
        client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: key,
            CopySource: copySource,
            CopySourceIfMatch: source.etag,
            ...(options?.overwrite ? {} : { IfNoneMatch: '*' }),
          }),
          { abortSignal: signal },
        ),
      );
      return;
    }
    const metadata = await this.run('rename', options, (client, signal) =>
      client.send(
        new HeadObjectCommand({ Bucket: sourceBucket, Key: source.key, IfMatch: source.etag }),
        { abortSignal: signal },
      ),
    );
    const attributes = {
      ...(metadata.Metadata ? { Metadata: metadata.Metadata } : {}),
      ...(metadata.ContentType ? { ContentType: metadata.ContentType } : {}),
      ...(metadata.ContentEncoding ? { ContentEncoding: metadata.ContentEncoding } : {}),
      ...(metadata.ContentDisposition ? { ContentDisposition: metadata.ContentDisposition } : {}),
      ...(metadata.CacheControl ? { CacheControl: metadata.CacheControl } : {}),
      ...(metadata.ContentLanguage ? { ContentLanguage: metadata.ContentLanguage } : {}),
    };
    if (source.size === 0n) {
      await this.run('rename', options, (client, signal) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: new Uint8Array(),
            ContentLength: 0,
            IfNoneMatch: '*',
            ...attributes,
          }),
          { abortSignal: signal },
        ),
      );
      return;
    }
    // MinIO может игнорировать условие назначения CopyObject; финализация multipart проверяет его.
    const partSize = Math.max(64 * 1048576, Math.ceil(Number(source.size) / 10000));
    if (partSize > 5 * 1024 ** 3) throw s3Failure(providerErrorCodes.unsupported, 'rename');
    const created = await this.run('rename', options, (client, signal) =>
      client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ...attributes }), {
        abortSignal: signal,
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw s3Failure(providerErrorCodes.ioError, 'rename');
    this.journal.add({ bucket, key, uploadId });
    try {
      const parts: CompletedPart[] = [];
      for (let offset = 0; offset < Number(source.size); offset += partSize) {
        const partNumber = parts.length + 1;
        const result = await this.run('rename', options, (client, signal) =>
          client.send(
            new UploadPartCopyCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              CopySource: copySource,
              CopySourceIfMatch: source.etag,
              ...(source.size > BigInt(partSize)
                ? {
                    CopySourceRange: `bytes=${offset}-${Math.min(Number(source.size) - 1, offset + partSize - 1)}`,
                  }
                : {}),
            }),
            { abortSignal: signal },
          ),
        );
        if (!result.CopyPartResult?.ETag)
          throw new ApplicationError(applicationErrorCodes.s3Integrity);
        parts.push({ PartNumber: partNumber, ETag: result.CopyPartResult.ETag });
      }
      await this.run('rename', options, (client, signal) =>
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
            ...(options?.overwrite ? {} : { IfNoneMatch: '*' }),
          }),
          { abortSignal: signal },
        ),
      );
      this.journal.remove(uploadId);
    } catch (error) {
      await this.cleanupUpload(uploadId);
      throw error;
    }
  }
  public async cleanupUpload(uploadId: string): Promise<void> {
    const record = this.journal.list().find((item) => item.uploadId === uploadId);
    if (!record) return;
    try {
      await this.run('write', undefined, (client, signal) =>
        client.send(
          new AbortMultipartUploadCommand({
            Bucket: record.bucket,
            Key: record.key,
            UploadId: uploadId,
          }),
          { abortSignal: signal },
        ),
      );
      this.journal.remove(uploadId);
    } catch (error) {
      if (error instanceof ProviderError && error.code === providerErrorCodes.notFound)
        this.journal.remove(uploadId);
      else throw new ApplicationError(applicationErrorCodes.s3Cleanup);
    }
  }
  public async openRead(
    path: ProviderPath,
    options?: ProviderOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const location = this.path(path, 'read');
    const entry = await this.stat(location, options);
    if (entry.kind !== 'file') throw s3Failure(providerErrorCodes.invalidPath, 'read');
    const offset = options?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || BigInt(offset) > entry.size)
      throw s3Failure(providerErrorCodes.invalidPath, 'read');
    if (options?.versionTag && options.versionTag !== entry.versionTag)
      throw new ApplicationError(applicationErrorCodes.unsafeResume);
    if (BigInt(offset) === entry.size)
      return new ReadableStream({ start: (controller) => controller.close() });
    const result = await this.run('read', options, (client, signal) =>
      client.send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          ChecksumMode: 'ENABLED',
          ...(offset ? { Range: `bytes=${offset}-` } : {}),
          ...(entry.versionTag ? { IfMatch: entry.versionTag } : {}),
        }),
        { abortSignal: signal },
      ),
    );
    if (!result.Body) throw s3Failure(providerErrorCodes.ioError, 'read');
    const reader = result.Body.transformToWebStream().getReader();
    let read = 0n;
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            if (options?.signal?.aborted) throw s3Failure(providerErrorCodes.cancelled, 'read');
            const part = await reader.read();
            if (part.done) {
              if (read !== entry.size - BigInt(offset))
                throw new ApplicationError(applicationErrorCodes.s3Integrity);
              reader.releaseLock();
              controller.close();
            } else {
              read += BigInt(part.value.byteLength);
              controller.enqueue(part.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => undefined);
            controller.error(normalizeS3Error(error, 'read'));
          }
        },
        cancel: async () => {
          await reader.cancel();
          reader.releaseLock();
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 65536 }),
    );
  }
  public async openWrite(
    path: ProviderPath,
    options: WriteOptions,
  ): Promise<WritableStream<Uint8Array>> {
    const location = this.path(path, 'write');
    if (
      !location.bucket ||
      !location.key ||
      location.key.endsWith('/') ||
      (options.offset ?? 0) !== 0
    )
      throw s3Failure(providerErrorCodes.unsupported, 'write');
    return this.run('write', options, async (client) =>
      createS3Upload(
        client,
        location.bucket,
        location.key,
        {
          ...options,
          signal: AbortSignal.any([
            this.lifetime.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
        },
        this.journal,
      ),
    );
  }
}
