import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { parseAdminEmails } from "@fuongz/auth";

/**
 * Everything this Worker is given. Secrets and vars are both strings at runtime;
 * the optional ones are optional because a deployment can legitimately run without
 * them (no system provider key ⇒ Default mode is simply unavailable).
 */
export interface Env {
  DB: D1Database;
  OUTPUTS: R2Bucket;
  /** Must match apps/web exactly, or keys minted there will not verify here. */
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  /** Base64 of 32 bytes, shared with apps/web. */
  PROVIDER_ENCRYPTION_KEY: string;
  SYSTEM_OPENROUTER_API_KEY?: string;
  SYSTEM_REPLICATE_API_TOKEN?: string;
  DEFAULT_DAILY_ANALYSES?: string;
  DEFAULT_DAILY_IMAGES?: string;
  SYSTEM_DAILY_ANALYSES?: string;
  SYSTEM_DAILY_IMAGES?: string;
  ALLOWED_ORIGINS?: string;
  /** Comma-separated emails allowed to change other accounts' limits. */
  ADMIN_EMAILS?: string;
}

/** A var that has to be a count. Anything unparseable falls back rather than NaN. */
function count(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface AllowanceLimits {
  analyses: number;
  images: number;
}

/** Per-user free allowance for one UTC day. */
export function userLimits(env: Env): AllowanceLimits {
  return {
    analyses: count(env.DEFAULT_DAILY_ANALYSES, 5),
    images: count(env.DEFAULT_DAILY_IMAGES, 1),
  };
}

/** The deployment-wide ceiling for the same day — the circuit breaker. */
export function systemLimits(env: Env): AllowanceLimits {
  return {
    analyses: count(env.SYSTEM_DAILY_ANALYSES, 200),
    images: count(env.SYSTEM_DAILY_IMAGES, 40),
  };
}

export function adminEmails(env: Env): string[] {
  return parseAdminEmails(env.ADMIN_EMAILS);
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
