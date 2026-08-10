import { openSecret } from "@fuongz/auth";
import type { GenerationMode, ProviderId } from "@fuongz/auth/schema";
import { providerCredential } from "@fuongz/auth/schema";
import { and, eq } from "drizzle-orm";
import type { Env } from "#/lib/env";
import { ApiError } from "#/lib/errors";
import type { Database } from "#/services/db";

/** Which system secret pays for a provider when the caller has no key of their own. */
const SYSTEM_KEY: Record<ProviderId, keyof Env> = {
  openrouter: "SYSTEM_OPENROUTER_API_KEY",
  replicate: "SYSTEM_REPLICATE_API_TOKEN",
};

export interface ResolvedCredential {
  mode: GenerationMode;
  /** Plaintext, for exactly one upstream call. Never stored, logged, or returned. */
  secret: string;
}

/**
 * Decide whose key pays for this call, and hand back that key.
 *
 * The mode is derived, not stored: a credential exists for this provider ⇒ BYOK,
 * none ⇒ Default. There is deliberately no switch anywhere — "default" means what
 * the word means, the thing that happens when you have not supplied an alternative.
 */
export async function resolveCredential(
  db: Database,
  env: Env,
  userId: string,
  provider: ProviderId,
): Promise<ResolvedCredential> {
  const [own] = await db
    .select({
      ciphertext: providerCredential.ciphertext,
      iv: providerCredential.iv,
    })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.userId, userId),
        eq(providerCredential.provider, provider),
      ),
    )
    .limit(1);

  if (own) {
    return {
      mode: "byok",
      secret: await openSecret(env.PROVIDER_ENCRYPTION_KEY, own),
    };
  }

  const system = env[SYSTEM_KEY[provider]];
  if (typeof system !== "string" || system.length === 0) {
    throw new ApiError(
      "provider_unavailable",
      `This deployment has no ${provider} key of its own. Add your own ${provider} key to keep using it.`,
      { details: { provider } },
    );
  }
  return { mode: "default", secret: system };
}

/**
 * The key that an ALREADY RECORDED call was paid with, for reconciling its poll.
 *
 * Not the same question as {@link resolveCredential}: that one decides the mode for a
 * new call, and a caller who added or removed a credential mid-flight would otherwise
 * have their in-progress prediction looked up with the wrong account's key.
 */
export async function credentialForMode(
  db: Database,
  env: Env,
  userId: string,
  provider: ProviderId,
  mode: GenerationMode,
): Promise<string> {
  if (mode === "default") {
    const system = env[SYSTEM_KEY[provider]];
    if (typeof system !== "string" || system.length === 0) {
      throw new ApiError(
        "provider_unavailable",
        `This generation ran on the deployment's own ${provider} key, but ${SYSTEM_KEY[provider]} is not set on this Worker — so it cannot be checked.`,
        { details: { provider } },
      );
    }
    return system;
  }

  const [own] = await db
    .select({
      ciphertext: providerCredential.ciphertext,
      iv: providerCredential.iv,
    })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.userId, userId),
        eq(providerCredential.provider, provider),
      ),
    )
    .limit(1);

  if (!own) {
    throw new ApiError(
      "provider_unavailable",
      `This generation was made with your own ${provider} key, which has since been removed. Add it back to check on it.`,
      { details: { provider } },
    );
  }
  return openSecret(env.PROVIDER_ENCRYPTION_KEY, own);
}

export interface ProviderStatus {
  mode: GenerationMode;
  /** Present only in BYOK mode, and only ever the last four characters. */
  last4: string | null;
  /** False when Default mode is the answer but the deployment has no system key. */
  available: boolean;
}

/** The same decision, reported without decrypting anything — for `GET /v1/me`. */
export async function describeProviders(
  db: Database,
  env: Env,
  userId: string,
): Promise<Record<ProviderId, ProviderStatus>> {
  const rows = await db
    .select({
      provider: providerCredential.provider,
      last4: providerCredential.last4,
    })
    .from(providerCredential)
    .where(eq(providerCredential.userId, userId));

  const owned = new Map(rows.map((row) => [row.provider, row.last4]));
  const describe = (provider: ProviderId): ProviderStatus => {
    const last4 = owned.get(provider);
    if (last4 !== undefined) return { mode: "byok", last4, available: true };
    const system = env[SYSTEM_KEY[provider]];
    return {
      mode: "default",
      last4: null,
      available: typeof system === "string" && system.length > 0,
    };
  };

  return { openrouter: describe("openrouter"), replicate: describe("replicate") };
}
