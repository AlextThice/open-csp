import { ApplicationError } from '../../ipc/application-error';
import { applicationErrorCodes } from '@shared/errors/application-error';
import {
  ProviderError,
  providerErrorCodes,
  type ProviderOperation,
  type ProviderErrorCode,
} from '@shared/providers/provider-error';

export const s3Failure = (code: ProviderErrorCode, operation: ProviderOperation) =>
  new ProviderError(code, { provider: 's3', operation });
export const normalizeS3Error = (error: unknown, operation: ProviderOperation): Error => {
  if (error instanceof ApplicationError || error instanceof ProviderError) return error;
  const field = (name: string): unknown =>
    error && typeof error === 'object' ? Reflect.get(error, name) : undefined;
  const code = String(field('Code') ?? field('code') ?? field('name') ?? '');
  const metadata = field('$metadata');
  const status: unknown =
    metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'httpStatusCode') : undefined;
  if (
    [
      'InvalidAccessKeyId',
      'SignatureDoesNotMatch',
      'ExpiredToken',
      'InvalidToken',
      'TokenRefreshRequired',
    ].includes(code)
  )
    return new ApplicationError(applicationErrorCodes.authenticationFailed);
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code))
    return new ApplicationError(applicationErrorCodes.s3Dns);
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/u.test(code))
    return new ApplicationError(applicationErrorCodes.s3Tls);
  if (
    [
      'InvalidEndpoint',
      'PermanentRedirect',
      'AuthorizationHeaderMalformed',
      'InvalidRegion',
    ].includes(code) ||
    status === 301
  )
    return new ApplicationError(applicationErrorCodes.s3Endpoint);
  if (['BadDigest', 'InvalidDigest', 'ChecksumMismatch'].includes(code))
    return new ApplicationError(applicationErrorCodes.s3Integrity);
  if (
    [
      'XMinioInvalidObjectName',
      'XMinioInvalidResourceName',
      'InvalidURI',
      'KeyTooLongError',
    ].includes(code)
  )
    return s3Failure(providerErrorCodes.invalidPath, operation);
  const normalized =
    code === 'AbortError'
      ? providerErrorCodes.cancelled
      : status === 403 || code === 'AccessDenied'
        ? providerErrorCodes.accessDenied
        : status === 404 || ['NoSuchKey', 'NoSuchBucket', 'NoSuchUpload', 'NotFound'].includes(code)
          ? providerErrorCodes.notFound
          : status === 409 || status === 412
            ? providerErrorCodes.conflict
            : status === 501 || code === 'NotImplemented'
              ? providerErrorCodes.unsupported
              : providerErrorCodes.ioError;
  return new ProviderError(normalized, { provider: 's3', operation, code }, { cause: error });
};
