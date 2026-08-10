import { sealSecret, secretLast4 } from "@fuongz/auth";
import { and, eq } from "drizzle-orm";
import { providerCredential } from "#/server/db/schema";
import { database, serverEnv } from "#/server/core/env";

export const PROVIDERS = ["openrouter", "replicate"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface CredentialStatus {
  provider: ProviderName;
  /** Present only when a key is stored, and only ever the last four characters. */
  last4: string | null;
  updatedAt: string | null;
}

/**
 * What the browser is allowed to know about stored provider keys.
 *
 * Never the key, never the ciphertext, never the IV. A page that could re-read a
 * saved secret is a page that leaks it the moment anything renders it by accident.
 */
export async function credentialStatuses(
  userId: string,
): Promise<CredentialStatus[]> {
  const db = await database();
  const rows = await db
    .select({
      provider: providerCredential.provider,
      last4: providerCredential.last4,
      updatedAt: providerCredential.updatedAt,
    })
    .from(providerCredential)
    .where(eq(providerCredential.userId, userId));

  const stored = new Map(rows.map((row) => [row.provider, row]));
  return PROVIDERS.map((provider) => {
    const row = stored.get(provider);
    return {
      provider,
      last4: row?.last4 ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function saveCredential(
  userId: string,
  provider: ProviderName,
  secret: string,
): Promise<void> {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("Enter an API key before saving.");

  const env = await serverEnv();
  const db = await database();
  const sealed = await sealSecret(env.PROVIDER_ENCRYPTION_KEY, trimmed);

  await db
    .insert(providerCredential)
    .values({
      id: crypto.randomUUID(),
      userId,
      provider,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      last4: secretLast4(trimmed),
      updatedAt: new Date(),
    })
    // Replacing a key reuses the row and takes a fresh IV with it — one key per
    // provider per account, so there is never an old ciphertext left behind.
    .onConflictDoUpdate({
      target: [providerCredential.userId, providerCredential.provider],
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        last4: secretLast4(trimmed),
        updatedAt: new Date(),
      },
    });
}

export async function removeCredential(
  userId: string,
  provider: ProviderName,
): Promise<void> {
  const db = await database();
  await db
    .delete(providerCredential)
    .where(
      and(
        eq(providerCredential.userId, userId),
        eq(providerCredential.provider, provider),
      ),
    );
}
