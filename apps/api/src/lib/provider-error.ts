import type { ProviderError } from "@fuongz/generation";
import { ApiError } from "#/lib/errors";

/**
 * The one translation from "the upstream failed" to a response.
 *
 * The failure itself is `@fuongz/generation`'s `ProviderError`, which knows nothing
 * about our status codes — that is what lets the web app reuse the same provider code.
 * Mapping it is this app's job: a caller-caused rejection is a 400 in our envelope
 * too, because reporting the caller's own malformed prompt as a 502 tells them to
 * retry something that will never work.
 */
export function providerApiError(error: ProviderError): ApiError {
  return new ApiError(
    error.causedByCaller ? "invalid_request" : "provider_failed",
    error.message,
    { cause: error },
  );
}
