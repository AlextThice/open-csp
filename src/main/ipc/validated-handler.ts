import { randomUUID } from 'node:crypto';
import { applicationErrorCodes, getSafeApplicationError } from '@shared/errors/application-error';
import type { IpcRequestEnvelope, IpcResponseEnvelope } from '@shared/ipc/contracts';
import type { z } from 'zod';
import { serializeApplicationError } from './application-error';
import { correlationIdSchema } from './schemas';

export interface ValidatedIpcHandlerOptions<Request, Response> {
  readonly createCorrelationId?: () => string;
  readonly handle: (request: Request) => Promise<Response> | Response;
  readonly requestSchema: z.ZodType<IpcRequestEnvelope<Request>>;
  readonly responseSchema: z.ZodType<Response>;
}

const readCorrelationId = (request: unknown, createCorrelationId: () => string): string => {
  if (typeof request !== 'object' || request === null) {
    return createCorrelationId();
  }

  const correlationIdResult = correlationIdSchema.safeParse(Reflect.get(request, 'correlationId'));

  return correlationIdResult.success ? correlationIdResult.data : createCorrelationId();
};

export const createValidatedIpcHandler = <Request, Response>(
  options: ValidatedIpcHandlerOptions<Request, Response>,
): ((request: unknown) => Promise<IpcResponseEnvelope<Response>>) => {
  const createCorrelationId = options.createCorrelationId ?? randomUUID;

  return async (request: unknown): Promise<IpcResponseEnvelope<Response>> => {
    const correlationId = readCorrelationId(request, createCorrelationId);
    const requestResult = options.requestSchema.safeParse(request);

    if (!requestResult.success) {
      return {
        correlationId,
        error: getSafeApplicationError(applicationErrorCodes.invalidIpcPayload),
        ok: false,
      };
    }

    try {
      const response = await options.handle(requestResult.data.payload);
      const responseResult = options.responseSchema.safeParse(response);

      if (!responseResult.success) {
        return {
          correlationId,
          error: getSafeApplicationError(applicationErrorCodes.internalError),
          ok: false,
        };
      }

      return {
        correlationId,
        data: responseResult.data,
        ok: true,
      };
    } catch (error: unknown) {
      return {
        correlationId,
        error: serializeApplicationError(error),
        ok: false,
      };
    }
  };
};
