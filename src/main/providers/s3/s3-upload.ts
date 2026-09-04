import { createHash } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { WriteOptions } from '@shared/providers/file-system-provider';
import { applicationErrorCodes } from '@shared/errors/application-error';
import { providerErrorCodes } from '@shared/providers/provider-error';
import { ApplicationError } from '../../ipc/application-error';
import { normalizeS3Error, s3Failure } from './s3-error';
import type { MultipartJournal } from './multipart-journal';

export const multipartPartSize = 8 * 1024 * 1024;
export const multipartConcurrency = 2;

export const createS3Upload = (
  client: S3Client,
  bucket: string,
  key: string,
  options: WriteOptions,
  journal: MultipartJournal,
): WritableStream<Uint8Array> => {
  const partSize = Math.max(
    multipartPartSize,
    Math.ceil(Number(options.expectedSize ?? 0n) / 10000 / 1048576) * 1048576,
  );
  if (partSize > 64 * 1048576) throw s3Failure(providerErrorCodes.unsupported, 'write');
  let buffer = Buffer.allocUnsafe(partSize);
  let used = 0;
  let total = 0n;
  let uploadId: string | undefined;
  let nextPart = 1;
  let failure: unknown;
  let isFinalized = false;
  let isStopped = false;
  let cleanupPromise: Promise<void> | undefined;
  const parts: CompletedPart[] = [];
  const inflight = new Set<Promise<void>>();
  const signal = () =>
    AbortSignal.any([AbortSignal.timeout(120000), ...(options.signal ? [options.signal] : [])]);
  const check = () => {
    if (options.signal?.aborted || isStopped)
      throw s3Failure(providerErrorCodes.cancelled, 'write');
    if (failure) throw failure;
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      isStopped = true;
      await Promise.all(inflight);
      if (uploadId && !isFinalized) {
        try {
          await client.send(
            new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
            { abortSignal: AbortSignal.timeout(15000) },
          );
          journal.remove(uploadId);
        } catch {
          throw new ApplicationError(applicationErrorCodes.s3Cleanup);
        }
      }
    })();
    return cleanupPromise;
  };
  const submit = async (body: Buffer): Promise<void> => {
    check();
    if (!uploadId) {
      const result = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
        { abortSignal: signal() },
      );
      if (!result.UploadId) throw s3Failure(providerErrorCodes.ioError, 'write');
      uploadId = result.UploadId;
      journal.add({ bucket, key, uploadId });
    }
    if (nextPart > 10000) throw s3Failure(providerErrorCodes.unsupported, 'write');
    const partNumber = nextPart++;
    const task = client
      .send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: body.length,
          ContentMD5: createHash('md5').update(body).digest('base64'),
        }),
        { abortSignal: signal() },
      )
      .then((result) => {
        if (!result.ETag) throw new ApplicationError(applicationErrorCodes.s3Integrity);
        parts.push({ PartNumber: partNumber, ETag: result.ETag });
      })
      .catch((error: unknown) => {
        failure ??= error;
      });
    inflight.add(task);
    void task.then(() => inflight.delete(task));
    if (inflight.size >= multipartConcurrency) await Promise.race(inflight);
    check();
  };
  const guarded = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      await cleanup();
      throw normalizeS3Error(error, 'write');
    }
  };
  return new WritableStream<Uint8Array>(
    {
      write: (chunk) =>
        guarded(async () => {
          check();
          total += BigInt(chunk.byteLength);
          if (options.expectedSize !== undefined && total > options.expectedSize)
            throw new ApplicationError(applicationErrorCodes.s3Integrity);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const length = Math.min(partSize - used, chunk.byteLength - offset);
            buffer.set(chunk.subarray(offset, offset + length), used);
            used += length;
            offset += length;
            if (used === partSize) {
              const full = buffer;
              buffer = Buffer.allocUnsafe(partSize);
              used = 0;
              await submit(full);
            }
          }
        }),
      close: () =>
        guarded(async () => {
          check();
          if (options.expectedSize !== undefined && total !== options.expectedSize)
            throw new ApplicationError(applicationErrorCodes.s3Integrity);
          const conditions = options.overwrite
            ? options.versionTag
              ? { IfMatch: options.versionTag }
              : {}
            : { IfNoneMatch: '*' };
          if (!uploadId) {
            const body = buffer.subarray(0, used);
            await client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentLength: used,
                ContentMD5: createHash('md5').update(body).digest('base64'),
                ...conditions,
              }),
              { abortSignal: signal() },
            );
          } else {
            if (used > 0) await submit(buffer.subarray(0, used));
            await Promise.all(inflight);
            check();
            await client.send(
              new CompleteMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: {
                  Parts: parts.sort(
                    (left, right) => (left.PartNumber ?? 0) - (right.PartNumber ?? 0),
                  ),
                },
                ...conditions,
              }),
              { abortSignal: signal() },
            );
            isFinalized = true;
            journal.remove(uploadId);
          }
          buffer = Buffer.alloc(0);
          isFinalized = true;
        }),
      abort: async () => {
        await cleanup();
        buffer = Buffer.alloc(0);
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 65536 }),
  );
};
