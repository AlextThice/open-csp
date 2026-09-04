import type { DatabaseSync } from 'node:sqlite';
import { ApplicationError } from '../ipc/application-error';
import { applicationErrorCodes } from '@shared/errors/application-error';

export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class CredentialService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly storage: SecureStorage,
  ) {}

  public encrypt(value: string): Buffer {
    this.assertAvailable();
    try {
      return this.storage.encryptString(value);
    } catch {
      throw new ApplicationError(applicationErrorCodes.secureStorageUnavailable);
    }
  }

  public read(id: string): string {
    this.assertAvailable();
    const row = this.database.prepare('SELECT ciphertext FROM credentials WHERE id = ?').get(id);
    try {
      if (!(row?.ciphertext instanceof Uint8Array)) throw new Error('Missing credential.');
      return this.storage.decryptString(Buffer.from(row.ciphertext));
    } catch {
      throw new ApplicationError(applicationErrorCodes.credentialRequired);
    }
  }

  private assertAvailable(): void {
    try {
      const backend = this.storage.getSelectedStorageBackend?.();
      if (
        !this.storage.isEncryptionAvailable() ||
        (backend !== undefined &&
          !['system', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend))
      ) {
        throw new Error('Unavailable secure storage.');
      }
    } catch {
      throw new ApplicationError(applicationErrorCodes.secureStorageUnavailable);
    }
  }
}
