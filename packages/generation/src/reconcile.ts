import { generation } from "@fuongz/auth/schema";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@fuongz/auth/schema";
import { getPrediction, isTerminal, outputUrl } from "./replicate";
import { type OutputBucket, storeOutput } from "./storage";

export type GenerationRow = typeof generation.$inferSelect;

/** D1 + the shared schema. Both apps build exactly this. */
export type GenerationDatabase = DrizzleD1Database<typeof schema>;

/**
 * What the reconciler needs from whoever is calling it.
 *
 * Shared because the API and the web app both have to be able to finish a generation:
 * the API does it on a poll, the web app does it when the gallery is opened. Passing
 * the pieces in — rather than an app's `Env` — is what keeps one implementation of the
 * provider call instead of two that can drift.
 */
export interface ReconcileContext {
  db: GenerationDatabase;
  bucket: OutputBucket;
  /**
   * The provider key that paid for this row, chosen by its RECORDED mode.
   *
   * Not by the account's current credentials: somebody who added or removed a key
   * mid-flight would otherwise have their in-progress prediction looked up with the
   * wrong account's key.
   */
  secretFor(row: GenerationRow): Promise<string>;
}

export interface Reconciled {
  row: GenerationRow;
  /**
   * The provider's own short-lived URL, handed back only for a generation the caller
   * asked us not to retain. There is nothing of ours to serve for those.
   */
  transientImageUrl: string | null;
}

async function update(
  db: GenerationDatabase,
  row: GenerationRow,
  values: Partial<typeof generation.$inferInsert>,
): Promise<GenerationRow> {
  const [updated] = await db
    .update(generation)
    .set(values)
    // Owner-scoped even here, where the row was just read by id: an update is as much
    // a way to touch someone else's row as a read is.
    .where(and(eq(generation.id, row.id), eq(generation.userId, row.userId)))
    .returning();
  if (!updated) throw new Error("the generation disappeared while being updated");
  return updated;
}

/**
 * Bring a generation's row up to date with what the provider actually did.
 *
 * Nothing schedules this — there is no webhook, no cron and no background timer. It
 * runs when somebody looks: the extension's poll, `GET /v1/generations`, or the web
 * app's gallery. That is what makes a client giving up harmless: the row keeps saying
 * `processing`, and whoever looks next finishes it.
 */
export async function reconcileGeneration(
  ctx: ReconcileContext,
  row: GenerationRow,
): Promise<Reconciled> {
  if (row.kind !== "image" || !row.providerRequestId) {
    return { row, transientImageUrl: null };
  }

  if (row.status === "processing") {
    const secret = await ctx.secretFor(row);
    const prediction = await getPrediction({ secret, id: row.providerRequestId });
    if (!isTerminal(prediction.status)) return { row, transientImageUrl: null };

    const source = prediction.status === "succeeded" ? outputUrl(prediction) : null;
    const completedAt = new Date();
    const latencyMs = completedAt.getTime() - row.createdAt.getTime();

    if (source) {
      // Copy into R2 before the row goes terminal. If storing throws, the row stays
      // `processing` and the next look tries again — better than a `succeeded` row
      // pointing at bytes that are about to expire.
      const stored = row.retained
        ? await storeOutput(ctx.bucket, row.id, source)
        : null;
      const updated = await update(ctx.db, row, {
        status: "succeeded",
        outputKey: stored?.key ?? null,
        outputContentType: stored?.contentType ?? null,
        completedAt,
        latencyMs,
      });
      return { row: updated, transientImageUrl: stored ? null : source };
    }

    const updated = await update(ctx.db, row, {
      status: "failed",
      errorCode: "provider_failed",
      errorMessage: (
        prediction.error ?? `The prediction ${prediction.status}.`
      ).slice(0, 500),
      // The price was recorded up front from the local table. A prediction that did
      // not produce an image did not cost what an image costs, and Replicate reports
      // no figure of its own — so the honest record is "unknown", not the estimate.
      costMicroUsd: null,
      costSource: null,
      completedAt,
      latencyMs,
    });
    return { row: updated, transientImageUrl: null };
  }

  // Already terminal. For a succeeded generation we were told not to keep, the only
  // way to hand back an image is to ask the provider for a fresh URL — best effort,
  // because a plain read should not fail just because the upstream is unreachable.
  if (row.status === "succeeded" && !row.outputKey) {
    try {
      const secret = await ctx.secretFor(row);
      const prediction = await getPrediction({ secret, id: row.providerRequestId });
      return { row, transientImageUrl: outputUrl(prediction) };
    } catch {
      return { row, transientImageUrl: null };
    }
  }

  return { row, transientImageUrl: null };
}

/**
 * Reconcile a page of rows, bounded, without letting one bad upstream break the read.
 *
 * A gallery of twenty `processing` rows must not become twenty upstream calls, and a
 * gallery that never reconciles leaves permanent ghosts. `max` is the compromise; the
 * rest are returned untouched and get their turn on the next look.
 */
export async function reconcileMany(
  ctx: ReconcileContext,
  rows: readonly GenerationRow[],
  max: number,
): Promise<Reconciled[]> {
  let budget = max;
  const settled: Reconciled[] = [];

  for (const row of rows) {
    if (row.status !== "processing" || budget === 0) {
      settled.push({ row, transientImageUrl: null });
      continue;
    }
    budget--;
    try {
      settled.push(await reconcileGeneration(ctx, row));
    } catch {
      settled.push({ row, transientImageUrl: null });
    }
  }
  return settled;
}
