import {
  deleteOutput,
  reconcileGeneration,
  reconcileMany,
} from "@fuongz/generation";
import { and, count, desc, eq, gte, sum } from "drizzle-orm";
import {
  dailyAllowance,
  generation,
  systemAllowance,
  userAllowance,
} from "#/server/db/schema";
import { database, serverEnv } from "#/server/core/env";
import { reconcileContext } from "#/server/core/reconcile";

export interface GenerationSummary {
  id: string;
  kind: string;
  mode: string;
  provider: string;
  model: string;
  status: string;
  prompt: string | null;
  sourceImageUrl: string | null;
  /** Our own route, when there are stored bytes to serve. */
  imageUrl: string | null;
  costMicroUsd: number | null;
  costSource: string | null;
  /** Present for analyses; what the prompt-generation table reports. */
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

/**
 * How many still-running rows one gallery load will chase.
 *
 * Bounded so a page of `processing` cards does not become a page of upstream calls;
 * whatever is left over gets its turn on the next load.
 */
const MAX_RECONCILES_PER_LOAD = 8;

/**
 * Newest first. Only ever this user's rows — the id is never the authorisation.
 *
 * Opening the gallery also FINISHES any `processing` row it finds: asks Replicate,
 * copies a finished image into R2, and writes the terminal status. Without this a
 * client that gave up mid-generation would leave a card that spins forever, because
 * nothing else is scheduled to look.
 */
export async function listGenerations(
  userId: string,
  limit = 60,
): Promise<GenerationSummary[]> {
  const db = await database();
  const found = await db
    .select()
    .from(generation)
    .where(eq(generation.userId, userId))
    .orderBy(desc(generation.createdAt))
    .limit(limit);

  const settled = await reconcileMany(
    await reconcileContext(db),
    found,
    MAX_RECONCILES_PER_LOAD,
  );
  const rows = settled.map((item) => item.row);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    provider: row.provider,
    model: row.model,
    status: row.status,
    prompt: row.prompt,
    sourceImageUrl: row.sourceImageUrl,
    imageUrl: row.outputKey ? `/api/generations/${row.id}/image` : null,
    costMicroUsd: row.costMicroUsd,
    costSource: row.costSource,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The row, but only if it belongs to this user. Used before serving stored bytes. */
export async function findOwnedGeneration(userId: string, id: string) {
  const db = await database();
  const [row] = await db
    .select()
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Reconcile ONE generation on request, and say so when it cannot be.
 *
 * The gallery already chases `processing` rows when it loads, but that pass is bounded
 * and swallows failures so one unreachable upstream cannot break the whole read. This
 * is the explicit version: it checks exactly the row asked for and lets the reason
 * through — "Replicate is unreachable" and "your key was removed" are things worth
 * seeing rather than a card that quietly stays grey.
 */
export async function checkGeneration(
  userId: string,
  id: string,
): Promise<GenerationSummary[]> {
  const db = await database();
  const row = await findOwnedGeneration(userId, id);
  if (!row) throw new Error("No such generation.");

  await reconcileGeneration(await reconcileContext(db), row);
  return listGenerations(userId);
}

export async function deleteGeneration(
  userId: string,
  id: string,
): Promise<void> {
  const env = await serverEnv();
  const db = await database();
  const row = await findOwnedGeneration(userId, id);
  if (!row) throw new Error("No such generation.");

  // Bytes first: a deleted row with a surviving object leaves storage nothing can
  // find its way back to.
  if (row.outputKey) await deleteOutput(env.OUTPUTS, row.outputKey);
  await db
    .delete(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)));
}

export interface SpendLine {
  provider: string;
  mode: string;
  requests: number;
  costMicroUsd: number;
}

export interface UsageReport {
  day: string;
  resetsAt: string;
  allowance: {
    analyses: { limit: number; used: number; source: "default" | "override" };
    images: { limit: number; used: number; source: "default" | "override" };
  };
  systemCeilingReached: boolean;
  today: SpendLine[];
  last30Days: SpendLine[];
}

/** A ceiling from the environment. Named apart from drizzle's `count()` aggregate. */
function envCount(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function spendSince(userId: string, since: Date): Promise<SpendLine[]> {
  const db = await database();
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

  return rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    requests: Number(row.requests),
    costMicroUsd: Number(row.costMicroUsd ?? 0),
  }));
}

/**
 * The allowance and the ledger, read together.
 *
 * The limits come from the same environment variables apps/api enforces. They are
 * read here rather than hard-coded so the page cannot claim a ceiling the API does not
 * actually apply — but note the two Workers have their own `vars`, so a change has to
 * be made in both.
 */
export async function usageReport(userId: string): Promise<UsageReport> {
  const env = (await serverEnv()) as Env & Record<string, string | undefined>;
  const db = await database();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const startOfDay = new Date(`${day}T00:00:00.000Z`);

  const [mine] = await db
    .select({
      analysesUsed: dailyAllowance.analysesUsed,
      imagesUsed: dailyAllowance.imagesUsed,
    })
    .from(dailyAllowance)
    .where(and(eq(dailyAllowance.userId, userId), eq(dailyAllowance.day, day)))
    .limit(1);

  const [shared] = await db
    .select({
      analysesUsed: systemAllowance.analysesUsed,
      imagesUsed: systemAllowance.imagesUsed,
    })
    .from(systemAllowance)
    .where(eq(systemAllowance.day, day))
    .limit(1);

  // The per-account override, read the same way apps/api reads it when it enforces.
  // A page that showed the deployment default to somebody who has an override would
  // be telling them a ceiling that is not theirs.
  const [override] = await db
    .select({
      analysesLimit: userAllowance.analysesLimit,
      imagesLimit: userAllowance.imagesLimit,
    })
    .from(userAllowance)
    .where(eq(userAllowance.userId, userId))
    .limit(1);

  const analysesLimit = override?.analysesLimit ?? envCount(env.DEFAULT_DAILY_ANALYSES, 5);
  const imagesLimit = override?.imagesLimit ?? envCount(env.DEFAULT_DAILY_IMAGES, 1);
  const systemAnalyses = envCount(env.SYSTEM_DAILY_ANALYSES, 200);
  const systemImages = envCount(env.SYSTEM_DAILY_IMAGES, 40);

  const [today, last30Days] = await Promise.all([
    spendSince(userId, startOfDay),
    spendSince(userId, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
  ]);

  return {
    day,
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString(),
    allowance: {
      analyses: {
        limit: Math.max(0, analysesLimit),
        used: mine?.analysesUsed ?? 0,
        source: override?.analysesLimit == null ? "default" : "override",
      },
      images: {
        limit: Math.max(0, imagesLimit),
        used: mine?.imagesUsed ?? 0,
        source: override?.imagesLimit == null ? "default" : "override",
      },
    },
    systemCeilingReached:
      (shared?.analysesUsed ?? 0) >= systemAnalyses ||
      (shared?.imagesUsed ?? 0) >= systemImages,
    today,
    last30Days,
  };
}
