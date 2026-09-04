import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { S3ConnectionProfile } from '../../src/shared/models/connection-profile';
import { S3Provider } from '../../src/main/providers/s3/s3-provider';
import type {
  MultipartJournal,
  MultipartRecord,
} from '../../src/main/providers/s3/multipart-journal';

export const minioProfile = (
  overrides: Partial<S3ConnectionProfile> = {},
): S3ConnectionProfile => ({
  id: randomUUID(),
  name: 'Disposable MinIO',
  kind: 's3',
  endpoint: 'http://127.0.0.1:29000',
  region: 'us-east-1',
  forcePathStyle: true,
  accessKeyId: 'fixture-access-only',
  bucket: 'fixture-bucket',
  ...overrides,
});
export const memoryJournal = (): MultipartJournal => {
  const records = new Map<string, MultipartRecord>();
  return {
    list: () => [...records.values()],
    add: (item) => {
      records.set(item.uploadId, item);
    },
    remove: (id) => {
      records.delete(id);
    },
  };
};
export const minioClient = () =>
  new S3Client({
    endpoint: 'http://127.0.0.1:29000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'fixture-access-only',
      secretAccessKey: 'fixture-secret-only-not-production',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
export const createMinioProvider = (
  overrides: Partial<S3ConnectionProfile> = {},
  secretAccessKey = 'fixture-secret-only-not-production',
) =>
  new S3Provider(minioProfile(overrides), async () => ({ secretAccessKey }), memoryJournal(), {
    pageSize: 2,
  });
