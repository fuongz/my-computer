import { user } from "@fuongz/auth/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { ApiError } from "#/lib/errors";
import type { ApiBindings } from "#/http/auth";
import { readAllowance } from "#/services/allowance";
import { describeProviders } from "#/services/credentials";
import { database } from "#/services/db";

/**
 * Everything a client needs to render its own setup screen in one round trip: who
 * the key belongs to, which mode each provider will run in, and what is left of
 * today's free allowance. Without this the extension would have to guess, and a
 * guessed allowance is a wrong allowance.
 */
export const meRoutes = new Hono<ApiBindings>().get("/", async (c) => {
  const caller = c.get("caller");
  const db = database(c.env);

  const [account] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, caller.userId))
    .limit(1);

  // A live key whose owner is gone: the account was deleted between minting and
  // now. Treat it as an unusable key rather than serving a half-empty answer.
  if (!account) {
    throw new ApiError("unauthorized", "This API key has no account behind it.");
  }

  const [providers, allowance] = await Promise.all([
    describeProviders(db, c.env, caller.userId),
    readAllowance(db, c.env, caller.userId),
  ]);

  return c.json({
    user: account,
    apiKey: { id: caller.apiKeyId },
    providers,
    allowance,
  });
});
