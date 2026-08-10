import { isAdminEmail } from "@fuongz/auth";
import { user } from "@fuongz/auth/schema";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { ApiBindings } from "#/http/auth";
import { adminEmails } from "#/lib/env";
import { ApiError } from "#/lib/errors";
import { database } from "#/services/db";

/**
 * Require that the verified caller is on the deployment's admin allowlist.
 *
 * Layered on top of {@link requireApiKey}, never instead of it: the key says who you
 * are, this says whether that person may change somebody else's limits. A 403 rather
 * than a 404 — the caller is authenticated and the route is real, and pretending
 * otherwise would only make a misconfigured allowlist harder to diagnose.
 */
export function requireAdmin(): MiddlewareHandler<ApiBindings> {
  return async (c, next) => {
    const caller = c.get("caller");
    const allowlist = adminEmails(c.env);

    // An empty allowlist means the deployment has no admins. Checking it first keeps
    // the default state closed rather than depending on a lookup returning nothing.
    if (allowlist.length === 0) {
      throw new ApiError("forbidden", "This deployment has no administrators.");
    }

    const [account] = await database(c.env)
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, caller.userId))
      .limit(1);

    if (!isAdminEmail(allowlist, account?.email)) {
      throw new ApiError("forbidden", "This endpoint is for administrators.");
    }
    await next();
  };
}
