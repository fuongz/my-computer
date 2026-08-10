/**
 * An upstream call that failed, carrying the one fact the refund rule needs.
 *
 * Whose fault it was decides whether a consumed allowance unit comes back. The
 * upstream rejecting the caller's own prompt or image URL is the caller's — refunding
 * that would make a malformed request an unlimited free retry. Everything else (our
 * system key being wrong, the provider being down, a timeout, a rate limit) is not
 * theirs to pay for.
 *
 * Deliberately knows nothing about HTTP status codes of ours: each app maps this to
 * its own response shape. That is what lets the web app reuse the same reconciler.
 */
export class ProviderError extends Error {
  readonly causedByCaller: boolean;
  /** Upstream HTTP status, when there was a response at all. */
  readonly status?: number;

  constructor(
    message: string,
    options: { causedByCaller: boolean; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.causedByCaller = options.causedByCaller;
    this.status = options.status;
  }

  /** A response we got back. 400/422 mean the upstream read the input and refused it. */
  static fromStatus(
    provider: string,
    status: number,
    detail?: string,
  ): ProviderError {
    return new ProviderError(
      detail
        ? `${provider} rejected the request (${status}): ${detail}`
        : `${provider} rejected the request (${status}).`,
      { causedByCaller: status === 400 || status === 422, status },
    );
  }

  /** No response at all — DNS, TLS, timeout, abort. Never the caller's fault. */
  static fromNetwork(provider: string, cause: unknown): ProviderError {
    return new ProviderError(`Could not reach ${provider}.`, {
      causedByCaller: false,
      cause,
    });
  }
}

/**
 * A short, bounded excerpt of an error body, for an audit row or a message.
 *
 * Bounded because an upstream error page can be a megabyte of HTML, and this text ends
 * up in a database column and in front of a person.
 */
export async function failureDetail(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.slice(0, 300) || undefined;
  } catch {
    return undefined;
  }
}
