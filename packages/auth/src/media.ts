/**
 * What a stored generation's `output_content_type` is allowed to be.
 *
 * The value originates in a provider's HTTP response, and both apps serve it back
 * from their own origin. Reflecting an arbitrary content type from your own origin is
 * how a stored file becomes a script: `text/html` served from the web app's domain
 * runs with the web app's cookies. Shared, because the column belongs to one schema
 * and two Workers read it.
 */
const SAFE_IMAGE_CONTENT_TYPES = new Set([
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/avif",
]);

/** True only for the image types we ever ask a provider to produce. */
export function isSafeImageContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  // `image/webp; charset=utf-8` — compare the type, not the parameters.
  const type = value.split(";")[0]?.trim().toLowerCase();
  return type !== undefined && SAFE_IMAGE_CONTENT_TYPES.has(type);
}

/**
 * The content type to serve for stored bytes.
 *
 * Anything unrecognised becomes `application/octet-stream`: a download rather than
 * something the browser will try to interpret. Always send it with
 * `X-Content-Type-Options: nosniff`, or the browser guesses anyway.
 */
export function safeImageContentType(value: string | null | undefined): string {
  return isSafeImageContentType(value)
    ? (value as string).split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream"
    : "application/octet-stream";
}
