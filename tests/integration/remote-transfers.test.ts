import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFixtureProvider, trustFixture } from './sftp-harness';
import { createMinioProvider } from './s3-harness';
import { TransferEngine } from '../../src/main/transfers/transfer-engine';
import {
  createS3ProviderPath,
  createSftpProviderPath,
} from '../../src/shared/models/provider-path';
import type { FileSystemProvider } from '../../src/shared/providers/file-system-provider';
import type { ProviderPath } from '../../src/shared/models/provider-path';

const hash = async (provider: FileSystemProvider, path: ProviderPath) => {
  const reader = (await provider.openRead(path)).getReader();
  const digest = createHash('sha256');
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      digest.update(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return digest.digest('hex');
};

describe('streaming SFTP ↔ S3 without local staging', () => {
  it('round-trips 256 MiB between real remote servers with bounded memory and backpressure', async () => {
    const fixture = createFixtureProvider();
    const s3 = createMinioProvider();
    const engine = new TransferEngine();
    const name = `remote-${randomUUID()}.bin`;
    const sourcePath = createSftpProviderPath('/home/fixture/data/large-sparse.bin');
    const s3Path = createS3ProviderPath('fixture-bucket', name);
    const returnedPath = createSftpProviderPath(`/home/fixture/data/${name}`);
    let peak = process.memoryUsage().rss;
    const baseline = peak;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);
    try {
      await trustFixture(fixture);
      await fixture.provider.connect();
      await s3.connect();
      const wait = (id: string) =>
        vi.waitFor(
          () => {
            const item = engine.snapshots().find((entry) => entry.id === id);
            expect(item?.state, item?.errorKey ?? '').toBe('completed');
          },
          { timeout: 180000, interval: 20 },
        );
      await wait(
        engine.enqueue({
          source: fixture.provider,
          destination: s3,
          sourcePath,
          destinationPath: s3Path,
          workspaceId: 'source',
          destinationWorkspaceId: 'target',
          direction: 'remote',
          conflictPolicy: 'ask',
        }),
      );
      await wait(
        engine.enqueue({
          source: s3,
          destination: fixture.provider,
          sourcePath: s3Path,
          destinationPath: returnedPath,
          workspaceId: 'target',
          destinationWorkspaceId: 'source',
          direction: 'remote',
          conflictPolicy: 'ask',
        }),
      );
      expect(await hash(fixture.provider, returnedPath)).toBe(
        await hash(fixture.provider, sourcePath),
      );
      expect(peak - baseline).toBeLessThan(192 * 1048576);
      process.stdout.write(
        `SFTP ↔ S3 256 MiB roundtrip: peak RSS increase ${Math.ceil((peak - baseline) / 1048576)} MiB.\n`,
      );
    } finally {
      clearInterval(timer);
      engine.dispose();
      await s3.delete(s3Path, { recursive: false }).catch(() => undefined);
      await fixture.provider.delete(returnedPath, { recursive: false }).catch(() => undefined);
      await s3.disconnect();
      await fixture.provider.disconnect();
    }
  });
});
