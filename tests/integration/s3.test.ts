import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3ProviderPath } from '../../src/shared/models/provider-path';
import { runFileSystemProviderContractTests } from '../providers/provider-contract';
import { createMinioProvider, minioClient } from './s3-harness';
import { minioProfile, memoryJournal } from './s3-harness';
import { S3Provider } from '../../src/main/providers/s3/s3-provider';

runFileSystemProviderContractTests('S3 (virtual directories; non-atomic rename)', async () => {
  const provider = createMinioProvider();
  const prefix = `contract-${randomUUID()}/`;
  const root = createS3ProviderPath('fixture-bucket', prefix);
  await provider.connect();
  await provider.createDirectory(root);
  await provider.disconnect();
  return {
    provider,
    root,
    path: (...segments) => createS3ProviderPath('fixture-bucket', `${prefix}${segments.join('/')}`),
    dispose: async () => {
      await provider.connect();
      await provider.delete(root, { recursive: true });
      await provider.disconnect();
    },
  };
});

describe('MinIO profiles and object operations', () => {
  const client = minioClient();
  let provider: ReturnType<typeof createMinioProvider>;
  let prefix: string;
  const path = (key = '') => createS3ProviderPath('fixture-bucket', `${prefix}${key}`);
  beforeEach(async () => {
    provider = createMinioProvider();
    prefix = `s3-${randomUUID()}/`;
    await provider.connect();
    await provider.createDirectory(path());
  });
  afterEach(async () => {
    await provider.delete(path(), { recursive: true });
    await provider.disconnect();
  });
  it('paginates beyond the first page and preserves Unicode, spaces, plus, percent and nested prefixes', async () => {
    const keys = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'Unicode ключ + %.txt',
      'nested/deep/item.txt',
      'zero.bin',
    ];
    for (const key of keys)
      await client.send(
        new PutObjectCommand({
          Bucket: 'fixture-bucket',
          Key: `${prefix}${key}`,
          Body: key === 'zero.bin' ? '' : key,
        }),
      );
    const listing = await provider.list(path());
    expect(listing.filter((item) => item.kind === 'file')).toHaveLength(6);
    expect(listing.find((item) => item.name === 'nested')?.s3Kind).toBe('prefix');
    const reader = (await provider.openRead(path('nested/deep/item.txt'))).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('nested/deep/item.txt');
    await reader.cancel();
    expect((await provider.stat(path('zero.bin'))).size).toBe(0n);
    await provider.copy(path('Unicode ключ + %.txt'), path('copy + %.txt'));
    await expect(
      provider.copy(path('Unicode ключ + %.txt'), path('copy + %.txt')),
    ).rejects.toMatchObject({ code: 'PROVIDER_CONFLICT' });
    await provider.rename(path('copy + %.txt'), path('renamed.txt'));
    expect((await provider.stat(path('Unicode ключ + %.txt'))).kind).toBe('file');
    await expect(provider.stat(path('copy + %.txt'))).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
    });
  });
  it('reports unsupported MinIO key components without silently normalizing them', async () => {
    for (const key of ['nested//item', 'nested/../item', 'nested/./item']) {
      const writer = (await provider.openWrite(path(key), { overwrite: false })).getWriter();
      await writer.write(new TextEncoder().encode('dummy'));
      await expect(writer.close()).rejects.toMatchObject({ code: 'PROVIDER_INVALID_PATH' });
    }
    expect(await provider.list(path())).toHaveLength(0);
  });
  it('rechecks each object and refuses a change detected after the manifest was built', async () => {
    const key = `${prefix}race.txt`;
    await client.send(new PutObjectCommand({ Bucket: 'fixture-bucket', Key: key, Body: 'before' }));
    const racingClient = minioClient();
    let checks = 0;
    racingClient.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'HeadObjectCommand' && ++checks === 2) {
          await client.send(
            new PutObjectCommand({ Bucket: 'fixture-bucket', Key: key, Body: 'after' }),
          );
        }
        return next(args);
      },
      { step: 'initialize', name: 'fixtureConcurrentChange' },
    );
    const racingProvider = new S3Provider(
      minioProfile(),
      async () => ({ secretAccessKey: 'fixture-secret-only-not-production' }),
      memoryJournal(),
      { client: racingClient },
    );
    try {
      await racingProvider.connect();
      await expect(
        racingProvider.delete(path('race.txt'), { recursive: false }),
      ).rejects.toMatchObject({ code: 'PROVIDER_CONFLICT' });
      expect((await provider.stat(path('race.txt'))).size).toBe(5n);
    } finally {
      await racingProvider.disconnect();
    }
  });
  it('calculates a delete preview, rejects stale plans and only deletes the confirmed prefix', async () => {
    await provider.createDirectory(path('tree/'));
    for (const key of ['a', 'b', 'c'])
      await client.send(
        new PutObjectCommand({
          Bucket: 'fixture-bucket',
          Key: `${prefix}tree/${key}`,
          Body: '123',
        }),
      );
    const preview = await provider.previewDelete(path('tree/'));
    expect(preview).toMatchObject({ count: 4, bytes: 9n });
    await client.send(
      new PutObjectCommand({ Bucket: 'fixture-bucket', Key: `${prefix}tree/new`, Body: 'new' }),
    );
    await expect(
      provider.deleteConfirmed(path('tree/'), preview.confirmationId),
    ).rejects.toMatchObject({ code: 'PROVIDER_CONFLICT' });
    await provider.rename(path('tree/'), path('renamed/'));
    const fresh = await provider.previewDelete(path('renamed/'));
    await provider.deleteConfirmed(path('renamed/'), fresh.confirmationId);
    expect(await provider.list(path())).toHaveLength(0);
  });
  it('tests a bucket with read-only credentials without requiring any writes', async () => {
    const readonly = createMinioProvider(
      { accessKeyId: 'fixture-readonly' },
      'fixture-readonly-password-only',
    );
    try {
      await readonly.connect();
      expect(readonly.connectionState).toBe('connected');
      await expect(readonly.list(path())).resolves.toEqual([]);
      await expect(readonly.createDirectory(path('forbidden/'))).rejects.toMatchObject({
        code: 'PROVIDER_ACCESS_DENIED',
      });
    } finally {
      await readonly.disconnect();
    }
  });
  it('lists buckets and distinguishes invalid credentials from a wrong endpoint', async () => {
    const all = createMinioProvider({ bucket: '' });
    const bad = createMinioProvider({ accessKeyId: 'fixture-invalid-access' });
    const endpoint = createMinioProvider({ endpoint: 'http://public.example.test' });
    try {
      await all.connect();
      expect((await all.list(createS3ProviderPath('', ''))).map((entry) => entry.name)).toEqual(
        expect.arrayContaining(['fixture-bucket', 'fixture-empty']),
      );
      await expect(bad.connect()).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
      await expect(endpoint.connect()).rejects.toMatchObject({ code: 'S3_ENDPOINT' });
    } finally {
      await all.disconnect();
      await bad.disconnect();
      await endpoint.disconnect();
    }
  });
});
