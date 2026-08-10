import type { ReconcileContext } from "@fuongz/generation";
import type { Env } from "#/lib/env";
import { credentialForMode } from "#/services/credentials";
import type { Database } from "#/services/db";

/**
 * This app's half of the shared reconciler.
 *
 * The reconciler itself lives in `@fuongz/generation` so the web app's gallery can
 * finish a generation with the same code rather than a second copy of the Replicate
 * call. All it needs from an app is a database, a bucket, and a way to get the key
 * that paid for a given row.
 */
export function reconcileContext(db: Database, env: Env): ReconcileContext {
  return {
    db,
    bucket: env.OUTPUTS,
    secretFor: (row) =>
      credentialForMode(db, env, row.userId, row.provider, row.mode),
  };
}
