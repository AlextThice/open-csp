import {
  ApplicationError as BaseApplicationError,
  applicationErrorCodes,
  getSafeApplicationError,
  type ApplicationErrorCode,
  type SerializedApplicationError,
} from '@shared/errors/application-error';
import { ProviderError } from '@shared/providers/provider-error';

export class ApplicationError extends BaseApplicationError<ApplicationErrorCode> {
  public constructor(code: ApplicationErrorCode, options?: ErrorOptions) {
    super(code, getSafeApplicationError(code).messageKey, options);
    this.name = 'ApplicationError';
  }
}

export const serializeApplicationError = (error: unknown): SerializedApplicationError => {
  if (error instanceof ApplicationError) {
    return getSafeApplicationError(error.code);
  }

  if (error instanceof ProviderError) {
    return getSafeApplicationError(error.code);
  }

  return getSafeApplicationError(applicationErrorCodes.internalError);
};
