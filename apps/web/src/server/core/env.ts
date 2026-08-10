import * as schema from "#/server/db/schema";
import { drizzle } from "drizzle-orm/d1";

/** The secrets and bindings this app reads beyond what Better Auth already uses. */
type AppEnv = Env & {
  /** Base64 of 32 bytes, shared with apps/api. */
  PROVIDER_ENCRYPTION_KEY: string;
};

/**
 * Cloudflare bindings, behind a dynamic import.
 *
 * `cloudflare:workers` only exists inside the Worker, so importing it at the top of a
 * module is how it ends up in a client bundle. This whole folder is server-only by
 * the layout audit; the dynamic import is what makes that enforceable rather than
 * merely intended.
 */
export async function serverEnv(): Promise<AppEnv> {
  const { env } = await import(/* @vite-ignore */ "cloudflare:workers");
  return env as AppEnv;
}

export async function database() {
  const env = await serverEnv();
  return drizzle(env.DB, { schema });
}

export type Database = Awaited<ReturnType<typeof database>>;
