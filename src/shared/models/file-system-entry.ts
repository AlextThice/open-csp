import type { ProviderPath } from '@shared/models/provider-path';

export type FileSystemEntryKind = 'directory' | 'file' | 'special' | 'symbolic-link';

export interface FileSystemEntry {
  readonly kind: FileSystemEntryKind;
  readonly s3Kind?: 'bucket' | 'prefix' | 'object';
  readonly versionTag?: string;
  readonly modifiedAt?: string;
  readonly name: string;
  readonly path: ProviderPath;
  readonly permissions?: number;
  readonly size: bigint;
}
