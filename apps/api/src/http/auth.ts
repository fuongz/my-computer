import { createApiAuth } from "@fuongz/auth";
import type { MiddlewareHandler } from "hono";
import type { Env } from "#/lib/env";
import { ApiError } from "#/lib/errors";

/** What the API knows about a caller once its bearer token has been verified. */
export interface Caller {
  userId: string;
  apiKeyId: string | null;
}

export type ApiBindings = {
  Bindings: Env;
  Variables: { caller: Caller };
};

/** The one wording used for every rejected token — see the note in the middleware. */
const REJECTED = "The API key is missing, unknown, disabled, or expired.";

/**
 * Require `Authorization: Bearer fz_…` on a route, and resolve who it belongs to.
 *
 * Every rejection returns the same message, whatever the real reason was. Telling an
 * unauthenticated caller *which* of "no such key" and "disabled key" applies hands
 * them a probe for guessing valid keys.
 */
export function requireApiKey(): MiddlewareHandler<ApiBindings> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new ApiError("unauthorized", REJECTED);

    const auth = createApiAuth(c.env);
    // Verified through the same plugin, secret, and tables that minted the key in
    // apps/web — which is the entire reason the config is a shared package. This
    // also advances the key's own request counter and transport rate limit.
    const result = await auth.api.verifyApiKey({ body: { key: token } });

    if (result.error?.code === "RATE_LIMITED") {
      throw new ApiError(
        "rate_limited",
        "This API key is making requests too quickly. Slow down and retry.",
      );
    }
    if (!result.valid || !result.key) throw new ApiError("unauthorized", REJECTED);

    c.set("caller", {
      // The api-key plugin stores the owning user on `referenceId`.
      userId: result.key.referenceId,
      apiKeyId: result.key.id ?? null,
    });
    await next();
  };
}
