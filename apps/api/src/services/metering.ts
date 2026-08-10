import type { GenerationMode, ProviderId } from "@fuongz/auth/schema";
import type { Env } from "#/lib/env";
import { ProviderError } from "@fuongz/generation";
import {
  type AllowanceUnit,
  consumeAllowance,
  refundAllowance,
} from "#/services/allowance";
import { resolveCredential } from "#/services/credentials";
import type { Database } from "#/services/db";

export interface MeteredCall {
  mode: GenerationMode;
  /** Plaintext provider key for exactly one upstream call. */
  secret: string;
}

/**
 * Settle who pays for a call, and take their unit if it is the deployment.
 *
 * Order matters: resolve the mode first, so a BYOK caller never touches the
 * allowance tables at all, then consume — always BEFORE the upstream request, so a
 * refusal costs nothing and two simultaneous requests cannot both slip past the
 * ceiling.
 */
export async function openMeteredCall(
  db: Database,
  env: Env,
  userId: string,
  provider: ProviderId,
  unit: AllowanceUnit,
): Promise<MeteredCall> {
  const credential = await resolveCredential(db, env, userId, provider);
  if (credential.mode === "default") {
    await consumeAllowance(db, env, userId, unit);
  }
  return credential;
}

/**
 * Unwind a metered call that failed.
 *
 * Refunds only when a unit was actually taken (Default mode) and the failure was
 * not the caller's own doing. A prompt the upstream refused keeps its unit —
 * otherwise a malformed request is an unlimited free retry.
 */
export async function closeFailedMeteredCall(
  db: Database,
  userId: string,
  unit: AllowanceUnit,
  mode: GenerationMode,
  error: unknown,
): Promise<void> {
  if (mode !== "default") return;
  if (error instanceof ProviderError && error.causedByCaller) return;
  await refundAllowance(db, userId, unit);
}
