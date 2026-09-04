import {
  ProviderError,
  providerErrorCodes,
  type ProviderErrorCode,
  type ProviderOperation,
} from '@shared/providers/provider-error';

const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
};

const mapErrorCode = (nativeCode: string | undefined): ProviderErrorCode => {
  switch (nativeCode) {
    case 'ABORT_ERR':
    case 'ECANCELED':
      return providerErrorCodes.cancelled;
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return providerErrorCodes.accessDenied;
    case 'EEXIST':
    case 'ENOTEMPTY':
      return providerErrorCodes.conflict;
    case 'ENOENT':
      return providerErrorCodes.notFound;
    case 'EISDIR':
    case 'EINVAL':
    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'ENOTDIR':
    case 'EXDEV':
      return providerErrorCodes.invalidPath;
    default:
      return providerErrorCodes.ioError;
  }
};

export const normalizeLocalProviderError = (
  error: unknown,
  operation: ProviderOperation,
): ProviderError => {
  if (error instanceof ProviderError) {
    return error;
  }

  const nativeCode = readErrorCode(error);
  const protocolCause =
    nativeCode === undefined
      ? { operation, provider: 'local' as const }
      : { code: nativeCode, operation, provider: 'local' as const };

  return new ProviderError(mapErrorCode(nativeCode), protocolCause, { cause: error });
};

export const createLocalProviderError = (
  code: ProviderErrorCode,
  operation: ProviderOperation,
): ProviderError =>
  new ProviderError(code, {
    operation,
    provider: 'local',
  });

export const throwIfLocalOperationAborted = (
  signal: AbortSignal | undefined,
  operation: ProviderOperation,
): void => {
  if (signal?.aborted === true) {
    throw createLocalProviderError(providerErrorCodes.cancelled, operation);
  }
};
