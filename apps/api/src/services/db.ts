import * as schema from "@fuongz/auth/schema";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "#/lib/env";

/** Drizzle over the same D1 the web app writes — one schema, from @fuongz/auth. */
export function database(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Database = ReturnType<typeof database>;
