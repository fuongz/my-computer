/**
 * One failure shape for the whole API: `{ error: { code, message } }`.
 *
 * The `code` is the part clients branch on — the extension has to tell "you are out
 * of free analyses today" apart from "the provider fell over", and a human-readable
 * message is the wrong thing to pattern-match.
 */

export const API_ERROR_CODES = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  /** Transport limit on the key itself. */
  rate_limited: 429,
  /** This user has spent their free daily allowance. */
  allowance_exhausted: 429,
  /** The deployment's daily ceiling is spent; BYOK still works. */
  system_allowance_exhausted: 429,
  /** Default mode was needed but the deployment has no system key for that provider. */
  provider_unavailable: 503,
  /** The upstream answered, and the answer was a failure. */
  provider_failed: 502,
  internal: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;
/** The literal union, not `number` — the HTTP layer needs a real status type. */
export type ApiErrorStatus = (typeof API_ERROR_CODES)[ApiErrorCode];

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;
  /** Seconds, for a `Retry-After` header. Only meaningful on the 429s. */
  readonly retryAfterSeconds?: number;
  /** Extra fields merged into the error object — never anything secret. */
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      retryAfterSeconds?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERROR_CODES[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export function errorBody(error: ApiError): {
  error: Record<string, unknown> & { code: ApiErrorCode; message: string };
} {
  return {
    error: { code: error.code, message: error.message, ...error.details },
  };
}
