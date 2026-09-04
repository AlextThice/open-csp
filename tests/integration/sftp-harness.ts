import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SftpConnectionProfile } from '../../src/shared/models/connection-profile';
import {
  SftpConnection,
  type SftpCredentials,
} from '../../src/main/providers/sftp/sftp-connection';
import { SftpProvider } from '../../src/main/providers/sftp/sftp-provider';

export const fixtureProfile = (): SftpConnectionProfile => ({
  id: randomUUID(),
  name: 'Disposable OpenSSH fixture',
  kind: 'sftp',
  host: '127.0.0.1',
  port: 22222,
  username: 'fixture',
  initialDirectory: '/home/fixture/data',
  timeout: 5000,
  keepalive: 1000,
  authentication: { method: 'agent' },
});
export const createFixtureProvider = (
  credentials: () => Promise<SftpCredentials> = async () => ({ password: 'fixture-password-only' }),
) => {
  const trusted = { fingerprint: undefined as string | undefined };
  const connection = new SftpConnection(fixtureProfile(), credentials, {
    getHostKey: () => trusted.fingerprint,
  });
  return { provider: new SftpProvider(connection), connection, trusted };
};
export const trustFixture = async (fixture: ReturnType<typeof createFixtureProvider>) => {
  try {
    await fixture.provider.connect();
  } catch {
    if (!fixture.connection.hostKey) throw new Error('Fixture host key was not presented.');
  }
  fixture.trusted.fingerprint = fixture.connection.hostKey?.fingerprint;
};
export const keyCredentials = async (): Promise<SftpCredentials> => ({
  privateKey: await readFile(resolve('tests/fixtures/runtime/id_ed25519')),
  passphrase: 'fixture-passphrase-only',
});
