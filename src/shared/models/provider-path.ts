export type ProviderKind = 'local' | 's3' | 'sftp';

export interface LocalProviderPath {
  readonly path: string;
  readonly provider: 'local';
}

export interface SftpProviderPath {
  readonly path: string;
  readonly provider: 'sftp';
}

export interface S3ProviderPath {
  readonly bucket: string;
  readonly key: string;
  readonly provider: 's3';
}

export type ProviderPath = LocalProviderPath | S3ProviderPath | SftpProviderPath;

export const createLocalProviderPath = (path: string): LocalProviderPath => ({
  path,
  provider: 'local',
});

export const createSftpProviderPath = (path: string): SftpProviderPath => ({
  path,
  provider: 'sftp',
});

export const createS3ProviderPath = (bucket: string, key: string): S3ProviderPath => ({
  bucket,
  key,
  provider: 's3',
});
