// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SftpConnection,
  type SftpCredentials,
} from '../../src/main/providers/sftp/sftp-connection';

describe('SFTP lifecycle races', () => {
  it('does not create a client after disconnecting during credential retrieval', async () => {
    let complete: ((credentials: SftpCredentials) => void) | undefined;
    const credentials = new Promise<SftpCredentials>((resolve) => {
      complete = resolve;
    });
    const connection = new SftpConnection(
      {
        id: 'fixture',
        kind: 'sftp',
        name: 'Fixture',
        host: '127.0.0.1',
        port: 1,
        username: 'fixture',
        authentication: { method: 'agent' },
      },
      () => credentials,
      { getHostKey: () => undefined },
    );
    const connecting = connection.connect();
    connection.disconnect();
    complete?.({ password: 'fixture-only' });
    await expect(connecting).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
    expect(connection.state).toBe('disconnected');
  });
});
