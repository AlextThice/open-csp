// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { formatS3Path, parseS3Path } from '../../src/shared/models/s3-path';
import { createS3ProviderPath } from '../../src/shared/models/provider-path';
import { s3EndpointSchema } from '../../src/shared/models/s3-profile';
import { workspaceRequestSchema } from '../../src/shared/ipc/workspace';
import { normalizeS3Error } from '../../src/main/providers/s3/s3-error';
import { serializeApplicationError } from '../../src/main/ipc/application-error';
import { S3Provider } from '../../src/main/providers/s3/s3-provider';
import {
  createS3Upload,
  multipartPartSize,
  multipartConcurrency,
} from '../../src/main/providers/s3/s3-upload';
import { memoryJournal, minioProfile } from '../integration/s3-harness';

const mockClient = (send: (command: unknown) => Promise<unknown>) => {
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'dummy-only', secretAccessKey: 'dummy-only' },
  });
  client.send = vi.fn(send) as typeof client.send;
  return client;
};

describe('S3 security and protocol boundaries', () => {
  it('preserves key bytes instead of normalizing POSIX components', () => {
    for (const key of ['dir//./../Unicode ключ + %#?.txt', '/leading', 'space /tail ', 'zero/']) {
      const path = createS3ProviderPath('fixture-bucket', key);
      expect(parseS3Path(formatS3Path(path))).toEqual(path);
    }
    expect(() => parseS3Path('file:///etc/passwd')).toThrow();
    expect(() => parseS3Path('s3://bucket/%zz')).toThrow();
  });
  it.each([
    'http://public.example.com',
    'https://user:password@example.com',
    'file:///tmp/data',
    'https://example.com/?secret=value',
    'https://example.com/path',
    'https://example.com/#fragment',
  ])('rejects unsafe endpoint %s', (endpoint) =>
    expect(s3EndpointSchema.safeParse(endpoint).success).toBe(false),
  );
  it.each([
    '',
    'https://s3.eu-west-1.amazonaws.com',
    'https://minio.example.com:9000',
    'http://127.0.0.1:29000',
    'http://localhost:9000',
  ])('accepts an AWS/compatible endpoint %s', (endpoint) =>
    expect(s3EndpointSchema.safeParse(endpoint).success).toBe(true),
  );
  it.each([
    ['ENOTFOUND', 'S3_DNS'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'S3_TLS'],
    ['InvalidAccessKeyId', 'AUTHENTICATION_FAILED'],
    ['ExpiredToken', 'AUTHENTICATION_FAILED'],
    ['AccessDenied', 'PROVIDER_ACCESS_DENIED'],
    ['AuthorizationHeaderMalformed', 'S3_ENDPOINT'],
    ['BadDigest', 'S3_INTEGRITY'],
    ['XMinioInvalidObjectName', 'PROVIDER_INVALID_PATH'],
  ])('normalizes %s without disclosing SDK data', (code, expected) => {
    const normalized = serializeApplicationError(
      normalizeS3Error(
        {
          name: code,
          message: 'dummy-secret',
          stack: 'internal-path',
          $response: { authorization: 'dummy-token' },
        },
        'connect',
      ),
    );
    expect(normalized.code).toBe(expected);
    expect(JSON.stringify(normalized)).not.toMatch(/dummy|internal-path/u);
  });
  it('rejects arbitrary SDK/TLS options at the IPC boundary', () => {
    expect(
      workspaceRequestSchema.safeParse({
        action: 'save-s3-profile',
        profile: {
          id: null,
          name: 'Test',
          endpoint: '',
          region: 'us-east-1',
          bucket: '',
          initialPrefix: '',
          accessKeyId: 'dummy',
          forcePathStyle: false,
          rejectUnauthorized: false,
        },
      }).success,
    ).toBe(false);
  });
  it('paginates bucket listing and does not start a connection after cancellation', async () => {
    const client = mockClient(async (command) =>
      command instanceof ListBucketsCommand
        ? command.input.ContinuationToken
          ? { Buckets: [{ Name: 'second-bucket' }] }
          : { Buckets: [{ Name: 'first-bucket' }], ContinuationToken: 'page2' }
        : {},
    );
    const provider = new S3Provider(
      minioProfile({ bucket: '' }),
      async () => ({ secretAccessKey: 'dummy' }),
      memoryJournal(),
      { client, pageSize: 1 },
    );
    await provider.connect();
    await provider.testConnection();
    expect((await provider.list(createS3ProviderPath('', ''))).map((entry) => entry.name)).toEqual([
      'first-bucket',
      'second-bucket',
    ]);
    await provider.disconnect();
    let resolveCredentials: ((value: { secretAccessKey: string }) => void) | undefined;
    const deferred = new S3Provider(
      minioProfile(),
      () =>
        new Promise((resolve) => {
          resolveCredentials = resolve;
        }),
      memoryJournal(),
      { client },
    );
    const connecting = deferred.connect();
    await deferred.disconnect();
    resolveCredentials?.({ secretAccessKey: 'dummy' });
    await expect(connecting).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
    expect(deferred.connectionState).toBe('disconnected');
  });
  it('does not normalize keys sent to AWS and sends a version-conditional Range read', async () => {
    const key = 'nested//./../file + %.txt';
    const commands: unknown[] = [];
    const client = mockClient(async (command) => {
      commands.push(command);
      if (command instanceof ListObjectsV2Command) return {};
      if (command instanceof HeadObjectCommand)
        return { ContentLength: 9, ETag: 'opaque-multipart-2' };
      if (command instanceof GetObjectCommand)
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start: (controller) => {
                  controller.enqueue(new TextEncoder().encode('suffix'));
                  controller.close();
                },
              }),
          },
        };
      return {};
    });
    const provider = new S3Provider(
      minioProfile(),
      async () => ({ secretAccessKey: 'dummy' }),
      memoryJournal(),
      { client },
    );
    await provider.connect();
    const reader = (
      await provider.openRead(createS3ProviderPath('fixture-bucket', key), {
        offset: 3,
        versionTag: 'opaque-multipart-2',
      })
    ).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('suffix');
    expect((await reader.read()).done).toBe(true);
    const request = commands.find((command) => command instanceof GetObjectCommand);
    expect(request).toBeInstanceOf(GetObjectCommand);
    if (request instanceof GetObjectCommand)
      expect(request.input).toMatchObject({
        Key: key,
        Range: 'bytes=3-',
        IfMatch: 'opaque-multipart-2',
      });
    await provider.disconnect();
  });
});

describe('bounded multipart uploads and cleanup', () => {
  it('limits parts in flight, checks each part with Content-MD5 and conditionally finalizes', async () => {
    const journal = memoryJournal();
    const commands: unknown[] = [];
    let inflight = 0;
    let peak = 0;
    const client = mockClient(async (command) => {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'dummy-upload' };
      if (command instanceof UploadPartCommand) {
        expect(journal.list()).toHaveLength(1);
        const body = command.input.Body;
        expect(Buffer.isBuffer(body)).toBe(true);
        if (Buffer.isBuffer(body)) {
          expect(body.length).toBeLessThanOrEqual(multipartPartSize);
          expect(command.input.ContentMD5).toBe(createHash('md5').update(body).digest('base64'));
        }
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inflight -= 1;
        return { ETag: `opaque-part-${command.input.PartNumber}` };
      }
      return {};
    });
    const writer = createS3Upload(
      client,
      'fixture-bucket',
      'large',
      { overwrite: false, expectedSize: BigInt(multipartPartSize * 3 + 1) },
      journal,
    ).getWriter();
    const chunk = Buffer.alloc(65536, 0x61);
    for (let index = 0; index < (multipartPartSize * 3) / chunk.length; index += 1)
      await writer.write(chunk);
    await writer.write(Uint8Array.of(1));
    await writer.close();
    expect(peak).toBeLessThanOrEqual(multipartConcurrency);
    expect(journal.list()).toHaveLength(0);
    const complete = commands.find((command) => command instanceof CompleteMultipartUploadCommand);
    if (!(complete instanceof CompleteMultipartUploadCommand))
      throw new Error('Missing multipart finalize.');
    expect(complete.input.IfNoneMatch).toBe('*');
    expect(complete.input.MultipartUpload?.Parts).toHaveLength(4);
    client.destroy();
  });
  it('records failed cleanup and never completes a cancelled multipart', async () => {
    const journal = memoryJournal();
    const commands: unknown[] = [];
    const client = mockClient(async (command) => {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'abandoned-fixture' };
      if (command instanceof UploadPartCommand) return { ETag: 'part' };
      if (command instanceof AbortMultipartUploadCommand) throw new Error('offline');
      return {};
    });
    const writer = createS3Upload(
      client,
      'fixture-bucket',
      'cancelled',
      { overwrite: false },
      journal,
    ).getWriter();
    for (let index = 0; index < 128; index += 1) await writer.write(Buffer.alloc(65536));
    await expect(writer.abort()).rejects.toMatchObject({ code: 'S3_CLEANUP' });
    expect(journal.list()).toEqual([
      { bucket: 'fixture-bucket', key: 'cancelled', uploadId: 'abandoned-fixture' },
    ]);
    expect(commands.some((command) => command instanceof CompleteMultipartUploadCommand)).toBe(
      false,
    );
    client.destroy();
  });
  it('rejects an incomplete source before publishing and handles zero bytes with conditional PutObject', async () => {
    const commands: unknown[] = [];
    const client = mockClient(async (command) => {
      commands.push(command);
      return {};
    });
    const writer = createS3Upload(
      client,
      'fixture-bucket',
      'incomplete',
      { overwrite: false, expectedSize: 2n },
      memoryJournal(),
    ).getWriter();
    await writer.write(Uint8Array.of(1));
    await expect(writer.close()).rejects.toMatchObject({ code: 'S3_INTEGRITY' });
    expect(commands).toHaveLength(0);
    await createS3Upload(
      client,
      'fixture-bucket',
      'empty',
      { overwrite: false, expectedSize: 0n },
      memoryJournal(),
    )
      .getWriter()
      .close();
    const request = commands[0];
    expect(request).toBeInstanceOf(PutObjectCommand);
    if (request instanceof PutObjectCommand)
      expect(request.input).toMatchObject({ ContentLength: 0, IfNoneMatch: '*' });
    client.destroy();
  });
});
