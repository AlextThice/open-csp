import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSftpProviderPath } from '../../src/shared/models/provider-path';
import { runFileSystemProviderContractTests } from '../providers/provider-contract';
import { createFixtureProvider, keyCredentials, trustFixture } from './sftp-harness';

describe('OpenSSH handshake', () => {
  it('rejects unknown and changed keys and accepts only explicitly trusted keys', async () => {
    const fixture = createFixtureProvider();
    try {
      await expect(fixture.provider.connect()).rejects.toMatchObject({ code: 'HOST_KEY_UNKNOWN' });
      expect(fixture.connection.hostKey?.fingerprint).toMatch(/^SHA256:/u);
      fixture.trusted.fingerprint = fixture.connection.hostKey?.fingerprint;
      await fixture.provider.connect();
      expect(fixture.provider.connectionState).toBe('connected');
      await fixture.provider.disconnect();
      fixture.trusted.fingerprint = 'SHA256:changed-fixture-key';
      await expect(fixture.provider.connect()).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' });
    } finally {
      await fixture.provider.disconnect();
    }
  });
  it('authenticates using an encrypted private key and rejects bad passwords', async () => {
    const key = createFixtureProvider(keyCredentials);
    const bad = createFixtureProvider(async () => ({ password: 'wrong-fixture-password' }));
    try {
      await trustFixture(key);
      await key.provider.connect();
      expect(key.provider.connectionState).toBe('connected');
      await trustFixture(bad);
      await expect(bad.provider.connect()).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    } finally {
      await key.provider.disconnect();
      await bad.provider.disconnect();
    }
  });
  it('reads Unicode and symlinks and normalizes permission and missing-path errors', async () => {
    const fixture = createFixtureProvider();
    try {
      await trustFixture(fixture);
      await fixture.provider.connect();
      const entries = await fixture.provider.list(createSftpProviderPath('/home/fixture/data'));
      expect(entries.some((entry) => entry.name === 'Unicode каталог')).toBe(true);
      expect(entries.find((entry) => entry.name === 'link-directory')?.kind).toBe('symbolic-link');
      const link = `/home/fixture/data/link-${randomUUID()}`;
      await new Promise<void>((resolve, reject) =>
        fixture.connection
          .control()
          .symlink('/home/fixture/data/Unicode каталог', link, (error) =>
            error ? reject(error) : resolve(),
          ),
      );
      await fixture.provider.delete(createSftpProviderPath(link), { recursive: true });
      expect(
        (await fixture.provider.stat(createSftpProviderPath('/home/fixture/data/Unicode каталог')))
          .kind,
      ).toBe('directory');
      await expect(
        fixture.provider.list(createSftpProviderPath('/home/fixture/data/restricted')),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACCESS_DENIED' });
      await expect(
        fixture.provider.stat(createSftpProviderPath('/missing-fixture-path')),
      ).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
    } finally {
      await fixture.provider.disconnect();
    }
  });
});

runFileSystemProviderContractTests('OpenSSH SFTP', async () => {
  const fixture = createFixtureProvider();
  await trustFixture(fixture);
  await fixture.provider.connect();
  const root = `/home/fixture/data/contract-${randomUUID()}`;
  await fixture.provider.createDirectory(createSftpProviderPath(root));
  await fixture.provider.disconnect();
  return {
    provider: fixture.provider,
    root: createSftpProviderPath(root),
    path: (...segments) => createSftpProviderPath([root, ...segments].join('/')),
    dispose: async () => {
      await fixture.provider.connect();
      await fixture.provider.delete(createSftpProviderPath(root), { recursive: true });
      await fixture.provider.disconnect();
    },
  };
});
