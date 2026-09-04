import { DatabaseSync } from 'node:sqlite';

export const migrateDatabase = (database: DatabaseSync): void => {
  database.exec('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;');
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (version > 3) throw new Error('Unsupported database version.');
  database.exec('BEGIN IMMEDIATE');
  try {
    if (version < 1) {
      database.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
        CREATE TABLE credentials (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, ciphertext BLOB NOT NULL);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      database.exec(
        `CREATE TABLE trusted_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(host, port)); PRAGMA user_version = 2;`,
      );
    }
    if (version < 3)
      database.exec(
        `CREATE TABLE multipart_cleanup (upload_id TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), bucket TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(profile_id, upload_id)); PRAGMA user_version = 3;`,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

export const openDatabase = (path: string): DatabaseSync => {
  const database = new DatabaseSync(path);
  try {
    migrateDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};
