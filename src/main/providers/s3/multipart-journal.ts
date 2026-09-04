import type { DatabaseSync } from 'node:sqlite';

export interface MultipartRecord {
  readonly uploadId: string;
  readonly bucket: string;
  readonly key: string;
}
export interface MultipartJournal {
  list(): readonly MultipartRecord[];
  add(record: MultipartRecord): void;
  remove(uploadId: string): void;
}
export class SqliteMultipartJournal implements MultipartJournal {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly profileId: string,
  ) {}
  public list(): readonly MultipartRecord[] {
    return this.database
      .prepare('SELECT upload_id, bucket, key FROM multipart_cleanup WHERE profile_id = ?')
      .all(this.profileId)
      .map((row) => ({
        uploadId: String(row.upload_id),
        bucket: String(row.bucket),
        key: String(row.key),
      }));
  }
  public add(record: MultipartRecord): void {
    this.database
      .prepare('INSERT INTO multipart_cleanup VALUES (?, ?, ?, ?)')
      .run(record.uploadId, this.profileId, record.bucket, record.key);
  }
  public remove(uploadId: string): void {
    this.database
      .prepare('DELETE FROM multipart_cleanup WHERE profile_id = ? AND upload_id = ?')
      .run(this.profileId, uploadId);
  }
}
