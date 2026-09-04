// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { migrateDatabase, openDatabase } from '../../src/main/persistence/database';
import { CredentialService, type SecureStorage } from '../../src/main/security/credential-service';
import { ProfileStore } from '../../src/main/persistence/profile-store';
import { redact } from '../../src/main/security/redact';
import type { SftpConnectionProfile } from '../../src/shared/models/connection-profile';

const secureStorage = (): SecureStorage => {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString: (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
};
const profile = (): SftpConnectionProfile => ({
  id: randomUUID(),
  kind: 'sftp',
  name: 'Fixture',
  host: '127.0.0.1',
  port: 22222,
  username: 'fixture',
  authentication: { method: 'password', secret: { id: randomUUID(), storage: 'safe-storage' } },
});

describe('persistence and credentials', () => {
  it.each(['basic_text', 'unknown', '', 'future_unverified_backend'])(
    'refuses %s before encryption, decryption or persistence',
    (backend) => {
      const database = openDatabase(':memory:');
      const encryptString = vi.fn();
      const decryptString = vi.fn();
      const credentials = new CredentialService(database, {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => backend,
        encryptString,
        decryptString,
      });
      expect(() => new ProfileStore(database, credentials).save(profile(), 'fixture')).toThrow(
        'errors.security.unavailable',
      );
      expect(() => credentials.read(randomUUID())).toThrow('errors.security.unavailable');
      expect(encryptString).not.toHaveBeenCalled();
      expect(decryptString).not.toHaveBeenCalled();
      expect(database.prepare('SELECT count(*) AS count FROM credentials').get()?.count).toBe(0);
      expect(database.prepare('SELECT count(*) AS count FROM profiles').get()?.count).toBe(0);
      database.close();
    },
  );
  it.each(['system', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    'accepts the secure %s backend',
    (backend) => {
      const database = openDatabase(':memory:');
      const credentials = new CredentialService(database, {
        ...secureStorage(),
        getSelectedStorageBackend: () => backend,
      });
      expect(credentials.encrypt('fixture').byteLength).toBeGreaterThan(0);
      database.close();
    },
  );
  it('maps backend discovery failures to a safe actionable error', () => {
    const database = openDatabase(':memory:');
    const credentials = new CredentialService(database, {
      ...secureStorage(),
      getSelectedStorageBackend: () => {
        throw new Error('Sensitive OS details.');
      },
    });
    expect(() => credentials.encrypt('fixture')).toThrow('errors.security.unavailable');
    database.close();
  });
  it('applies migrations repeatedly and upgrades existing profile data', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(
      'CREATE TABLE profiles (id TEXT PRIMARY KEY, metadata TEXT NOT NULL); CREATE TABLE credentials (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, ciphertext BLOB NOT NULL); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;',
    );
    database.prepare('INSERT INTO settings VALUES (?, ?)').run('language', 'ru');
    migrateDatabase(database);
    migrateDatabase(database);
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    expect(database.prepare('SELECT value FROM settings').get()?.value).toBe('ru');
    database.close();
  });
  it('encrypts secrets, replaces them transactionally, and deletes them with the profile', () => {
    const database = openDatabase(':memory:');
    const credentials = new CredentialService(database, secureStorage());
    const store = new ProfileStore(database, credentials);
    const saved = store.save(profile(), 'fixture-password-only');
    expect(saved.kind).toBe('sftp');
    if (saved.kind !== 'sftp' || saved.authentication.method !== 'password')
      throw new Error('Unexpected profile.');
    expect(credentials.read(saved.authentication.secret.id)).toBe('fixture-password-only');
    expect(JSON.stringify(store.list())).not.toContain('fixture-password-only');
    const blob = database.prepare('SELECT ciphertext FROM credentials').get()?.ciphertext;
    expect(Buffer.from(blob as Uint8Array).includes(Buffer.from('fixture-password-only'))).toBe(
      false,
    );
    store.save(saved, 'replacement-fixture-only');
    expect(database.prepare('SELECT count(*) AS count FROM credentials').get()?.count).toBe(1);
    store.delete(saved.id);
    expect(database.prepare('SELECT count(*) AS count FROM credentials').get()?.count).toBe(0);
    database.close();
  });
  it('rejects unavailable/basic_text backends and corrupted ciphertext safely', () => {
    const database = openDatabase(':memory:');
    const storage = secureStorage();
    expect(() =>
      new CredentialService(database, { ...storage, isEncryptionAvailable: () => false }).encrypt(
        'fixture',
      ),
    ).toThrow('errors.security.unavailable');
    expect(() =>
      new CredentialService(database, {
        ...storage,
        getSelectedStorageBackend: () => 'basic_text',
      }).encrypt('fixture'),
    ).toThrow('errors.security.unavailable');
    const credentials = new CredentialService(database, storage);
    const store = new ProfileStore(database, credentials);
    const saved = store.save(profile(), 'fixture');
    database.exec("UPDATE credentials SET ciphertext = X'00'");
    if (saved.kind !== 'sftp' || saved.authentication.method !== 'password')
      throw new Error('Unexpected profile.');
    const secretId = saved.authentication.secret.id;
    expect(() => credentials.read(secretId)).toThrow('errors.security.credentialRequired');
    database.close();
  });
  it('redacts nested secrets, binary data and exception details', () => {
    const output = JSON.stringify(
      redact(
        {
          password: 'fixture-a',
          nested: { accessKeySecret: 'fixture-b', sessionToken: 'fixture-c' },
          error: new Error('fixture-a'),
          text: 'contains fixture-d',
        },
        ['fixture-d'],
      ),
    );
    for (const secret of ['fixture-a', 'fixture-b', 'fixture-c', 'fixture-d'])
      expect(output).not.toContain(secret);
  });
});
