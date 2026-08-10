import { openSecret } from "@fuongz/auth";
import type { GenerationRow, ReconcileContext } from "@fuongz/generation";
import { providerCredential } from "#/server/db/schema";
import { and, eq } from "drizzle-orm";
import { type Database, serverEnv } from "#/server/core/env";

/** Which system secret paid for a row whose recorded mode is `default`. */
const SYSTEM_KEY = {
  openrouter: "SYSTEM_OPENROUTER_API_KEY",
  replicate: "SYSTEM_REPLICATE_API_TOKEN",
} as const;

/**
 * This app's half of the shared reconciler.
 *
 * The gallery has to be able to finish a generation whose client gave up — otherwise a
 * closed tab leaves a `processing` card that never resolves. It uses the same
 * reconciler as the API (`@fuongz/generation`) rather than its own copy of the
 * Replicate call, which is the whole reason that package exists.
 *
 * This is why this Worker also needs `SYSTEM_REPLICATE_API_TOKEN`: to ask about a
 * prediction that the deployment's own key started.
 */
export async function reconcileContext(db: Database): Promise<ReconcileContext> {
  const env = (await serverEnv()) as Awaited<ReturnType<typeof serverEnv>> &
    Record<string, string | undefined>;

  return {
    db,
    bucket: env.OUTPUTS,
    secretFor: async (row: GenerationRow) => {
      if (row.mode === "default") {
        const system = env[SYSTEM_KEY[row.provider]];
        if (!system) {
          // Name the variable: this is a deployment configuration problem, and the
          // person reading it is the person who can fix it. `.dev.vars` is only read
          // when the dev server starts, so a fresh value needs a restart.
          throw new Error(
            `This generation ran on the deployment's own ${row.provider} key, but ${SYSTEM_KEY[row.provider]} is not set on this Worker — so it cannot be checked. Set it (and restart, in development).`,
          );
        }
        return system;
      }

      // Chosen by the row's RECORDED mode, so a credential added or removed since the
      // prediction started cannot send us looking with the wrong account's key.
      const [own] = await db
        .select({
          ciphertext: providerCredential.ciphertext,
          iv: providerCredential.iv,
        })
        .from(providerCredential)
        .where(
          and(
            eq(providerCredential.userId, row.userId),
            eq(providerCredential.provider, row.provider),
          ),
        )
        .limit(1);

      if (!own) {
        throw new Error(
          `This generation used your own ${row.provider} key, which has since been removed.`,
        );
      }
      return openSecret(env.PROVIDER_ENCRYPTION_KEY, own);
    },
  };
}
