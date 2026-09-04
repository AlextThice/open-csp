import { createS3ProviderPath, type S3ProviderPath } from './provider-path';

// Ключи S3 не нормализуются как POSIX-пути: повторные /, . и .. значимы.
export const formatS3Path = (path: S3ProviderPath): string =>
  `s3://${path.bucket}/${path.key.split('/').map(encodeURIComponent).join('/')}`;

export const parseS3Path = (value: string): S3ProviderPath => {
  const match = /^s3:\/\/([^/]*)(?:\/(.*))?$/u.exec(value);
  if (!match) throw new Error('Invalid S3 path.');
  return createS3ProviderPath(
    match[1] ?? '',
    (match[2] ?? '').split('/').map(decodeURIComponent).join('/'),
  );
};

export const s3Prefix = (key: string): string =>
  key === '' || key.endsWith('/') ? key : `${key}/`;

export const s3Name = (key: string): string =>
  (key.endsWith('/') ? key.slice(0, -1) : key).split('/').at(-1) ?? '';

export const s3Child = (parent: string, name: string, directory: boolean): string => {
  const path = parseS3Path(parent);
  return formatS3Path(
    createS3ProviderPath(path.bucket, `${s3Prefix(path.key)}${name}${directory ? '/' : ''}`),
  );
};
