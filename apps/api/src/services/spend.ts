import { generation } from "@fuongz/auth/schema";
import { and, count, eq, gte, sum } from "drizzle-orm";
import type { Database } from "#/services/db";

export interface SpendLine {
  provider: string;
  mode: string;
  requests: number;
  costMicroUsd: number;
}

export interface SpendSummary {
  since: string;
  totalCostMicroUsd: number;
  byProviderAndMode: SpendLine[];
}

/**
 * What this account has spent, grouped by who paid and where it went.
 *
 * This is the audit half of the promise: BYOK callers are never blocked on cost, so
 * the only thing that makes their spend knowable is a ledger they can read. Summed in
 * SQL over integer micro-USD, so the total is exact rather than nearly right.
 */
export async function spendSince(
  db: Database,
  userId: string,
  since: Date,
): Promise<SpendSummary> {
  const rows = await db
    .select({
      provider: generation.provider,
      mode: generation.mode,
      requests: count(),
      costMicroUsd: sum(generation.costMicroUsd),
    })
    .from(generation)
    .where(and(eq(generation.userId, userId), gte(generation.createdAt, since)))
    .groupBy(generation.provider, generation.mode);

  const byProviderAndMode = rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    requests: Number(row.requests),
    // `sum()` comes back as a string (or null when every row's cost is unknown).
    costMicroUsd: Number(row.costMicroUsd ?? 0),
  }));

  return {
    since: since.toISOString(),
    totalCostMicroUsd: byProviderAndMode.reduce(
      (total, line) => total + line.costMicroUsd,
      0,
    ),
    byProviderAndMode,
  };
}
