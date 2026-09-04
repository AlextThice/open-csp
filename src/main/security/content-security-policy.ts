export const productionContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

type ResponseHeaders = Record<string, string[]>;

export interface HeadersReceivedDetails {
  readonly responseHeaders?: ResponseHeaders;
}

export interface HeadersReceivedResponse {
  readonly responseHeaders: ResponseHeaders;
}

export interface HeaderInterceptor {
  readonly onHeadersReceived: (
    listener: (
      details: HeadersReceivedDetails,
      callback: (response: HeadersReceivedResponse) => void,
    ) => void,
  ) => void;
}

export const createProductionResponseHeaders = (
  originalHeaders: ResponseHeaders | undefined,
): ResponseHeaders => {
  const responseHeaders: ResponseHeaders = {};

  for (const [name, values] of Object.entries(originalHeaders ?? {})) {
    if (name.toLowerCase() !== 'content-security-policy') {
      responseHeaders[name] = values;
    }
  }

  responseHeaders['Content-Security-Policy'] = [productionContentSecurityPolicy];

  return responseHeaders;
};

export const configureProductionContentSecurityPolicy = (interceptor: HeaderInterceptor): void => {
  interceptor.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: createProductionResponseHeaders(details.responseHeaders),
    });
  });
};
