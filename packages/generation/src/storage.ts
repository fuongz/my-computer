import { isSafeImageContentType, safeImageContentType } from "@fuongz/auth";
import { ProviderError } from "./provider-error";

/**
 * What this package needs from an R2 bucket, declared structurally.
 *
 * NOT `R2Bucket` from `@cloudflare/workers-types`: the web app's bucket type comes
 * from wrangler's generated runtime types, where `get()` is a union covering the
 * `onlyIf` overload. Two type libraries describing the same binding differently is not
 * something a shared package should force its consumers to resolve — so it asks for
 * the three methods it actually calls and lets either type satisfy them.
 */
export interface OutputBucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** The half of an R2 object a caller needs to serve it. */
export interface StoredObject {
  body: ReadableStream;
  size: number;
}

/**
 * The only hosts this Worker will fetch bytes from.
 *
 * Everything else it handles is a URL it forwards to a provider; this is the one
 * place it dereferences a URL itself, and the URL came from a provider response. An
 * allowlist keeps that from becoming a way to aim our egress at an arbitrary address.
 */
const OUTPUT_HOST_SUFFIX = ".replicate.delivery";

/** Generous for a single generated image, small enough not to threaten the isolate. */
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function assertAllowedHost(url: URL): void {
  const allowed =
    url.protocol === "https:" &&
    (url.hostname === "replicate.delivery" ||
      url.hostname.endsWith(OUTPUT_HOST_SUFFIX));
  if (!allowed) {
    throw new ProviderError(
      `Refusing to fetch generated output from an unexpected host: ${url.hostname}`,
      { causedByCaller: false },
    );
  }
}

export interface StoredOutput {
  key: string;
  contentType: string;
  size: number;
}

/**
 * Copy a provider's output into R2, so history survives the provider's own URL
 * expiring an hour later.
 */
export async function storeOutput(
  bucket: OutputBucket,
  generationId: string,
  sourceUrl: string,
): Promise<StoredOutput> {
  const url = new URL(sourceUrl);
  assertAllowedHost(url);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (cause) {
    throw ProviderError.fromNetwork("Replicate output storage", cause);
  }
  if (!response.ok) {
    throw ProviderError.fromStatus("Replicate output storage", response.status);
  }

  const declaredLength = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OUTPUT_BYTES) {
    throw new ProviderError("The generated image is too large to store.", {
      causedByCaller: false,
    });
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new ProviderError("The generated image is too large to store.", {
      causedByCaller: false,
    });
  }

  // We asked for a webp. Anything else means something is wrong upstream, and storing
  // it would put a provider-chosen content type on a URL served from our own origin.
  const declaredType = response.headers.get("Content-Type");
  if (!isSafeImageContentType(declaredType)) {
    throw new ProviderError(
      `The generated output was not an image (${declaredType ?? "no content type"}).`,
      { causedByCaller: false },
    );
  }
  // Normalised on the way in, so the stored column never carries parameters or case
  // that the routes serving it would have to re-handle.
  const contentType = safeImageContentType(declaredType);

  const key = `generations/${generationId}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  return { key, contentType, size: bytes.byteLength };
}

export async function readOutput(
  bucket: OutputBucket,
  key: string,
): Promise<StoredObject | null> {
  const object = await bucket.get(key);
  // Single-argument `get` always returns a body-bearing object. The union in the
  // generated types exists for the `onlyIf` overload, which nothing here uses.
  return (object as StoredObject | null) ?? null;
}

export async function deleteOutput(
  bucket: OutputBucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}
