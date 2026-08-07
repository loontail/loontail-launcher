export const YggdrasilErrorCodes = {
  INVALID_UUID: 'invalid_uuid',
  INVALID_PNG: 'invalid_png',
  NETWORK: 'network',
  HTTP_ERROR: 'http_error',
  INVALID_RESPONSE: 'invalid_response',
  AUTHLIB_INJECTOR_MISSING: 'authlib_injector_missing',
} as const;

export type YggdrasilErrorCode = (typeof YggdrasilErrorCodes)[keyof typeof YggdrasilErrorCodes];

export type YggdrasilErrorOptions = {
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
};

export class YggdrasilError extends Error {
  readonly code: YggdrasilErrorCode;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(code: YggdrasilErrorCode, message: string, options?: YggdrasilErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'YggdrasilError';
    this.code = code;
    if (options?.context) {
      this.context = Object.freeze({ ...options.context });
    }
  }
}
