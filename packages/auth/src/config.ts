import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index";

/** Every issued key carries this, so a leaked string is recognisable on sight. */
export const API_KEY_PREFIX = "fz_";

/**
 * Per-key transport limit, stamped onto each key row when it is created.
 *
 * The plugin's own default is 10 requests per 24 hours, which a single session of
 * "analyse, generate, poll" would exhaust before lunch. This is abuse protection
 * on the connection, and is deliberately unrelated to the free daily allowance —
 * that one meters whose money is being spent, this one meters request volume.
 *
 * Because the values live on the key row, changing them here only affects keys
 * created afterwards; existing keys keep whatever they were issued with.
 */
export const API_KEY_RATE_LIMIT = {
  enabled: true,
  timeWindow: 60_000,
  maxRequests: 60,
} as const;

/** What any app needs in its environment to build a Better Auth instance. */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
}

/**
 * The API-key plugin, configured once.
 *
 * Both apps must agree on prefix and hashing or keys minted by one would be
 * unverifiable by the other — which is the whole reason this package exists.
 */
export function apiKeyPlugin() {
  return apiKey({
    defaultPrefix: API_KEY_PREFIX,
    requireName: true,
    rateLimit: { ...API_KEY_RATE_LIMIT },
  });
}

export function authDatabase(db: D1Database) {
  return drizzleAdapter(drizzle(db, { schema }), {
    provider: "sqlite",
    schema,
  });
}

/**
 * The half of the Better Auth options that every app shares.
 *
 * Each app spreads this and adds only what is true of itself — the web app adds
 * GitHub and cookie handling, the API adds nothing at all. Returning options
 * rather than a finished instance is what keeps each app's `auth.api` fully typed.
 */
export function authBase(env: AuthEnv) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: authDatabase(env.DB),
  };
}
