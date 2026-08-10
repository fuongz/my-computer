import type {
  GenerationKind,
  GenerationMode,
  GenerationStatus,
  ProviderId,
} from "@fuongz/auth/schema";
import { generation } from "@fuongz/auth/schema";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { ApiError } from "#/lib/errors";
import type { Database } from "#/services/db";

/** The public JSON shape of a generation, defined once and used by every route. */
export interface GenerationView {
  id: string;
  kind: GenerationKind;
  mode: GenerationMode;
  provider: ProviderId;
  model: string;
  status: GenerationStatus;
  retained: boolean;
  prompt: string | null;
  sourceImageUrl: string | null;
  /** Where to fetch the bytes. Our own route when retained, the provider's when not. */
  imageUrl: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  costSource: "provider" | "estimate" | null;
  latencyMs: number | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  completedAt: string | null;
}

type GenerationRow = typeof generation.$inferSelect;

export function viewOf(
  row: GenerationRow,
  options: { origin: string; transientImageUrl?: string | null } = { origin: "" },
): GenerationView {
  return {
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    provider: row.provider,
    model: row.model,
    status: row.status,
    retained: row.retained,
    prompt: row.prompt,
    sourceImageUrl: row.sourceImageUrl,
    imageUrl: row.outputKey
      ? `${options.origin}/v1/generations/${row.id}/image`
      : (options.transientImageUrl ?? null),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicroUsd: row.costMicroUsd,
    costSource: row.costSource,
    latencyMs: row.latencyMs,
    error: row.errorCode
      ? { code: row.errorCode, message: row.errorMessage ?? "" }
      : null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function insertGeneration(
  db: Database,
  values: typeof generation.$inferInsert,
): Promise<GenerationRow> {
  const [row] = await db.insert(generation).values(values).returning();
  if (!row) throw new Error("failed to record the generation");
  return row;
}

export async function updateGeneration(
  db: Database,
  id: string,
  userId: string,
  values: Partial<typeof generation.$inferInsert>,
): Promise<GenerationRow> {
  const [row] = await db
    .update(generation)
    .set(values)
    // Scoped by owner as well as id: an update is as much a way to touch someone
    // else's row as a read is.
    .where(and(eq(generation.id, id), eq(generation.userId, userId)))
    .returning();
  if (!row) throw new ApiError("not_found", "No such generation.");
  return row;
}

/**
 * One generation belonging to this caller.
 *
 * A row that exists but belongs to somebody else is a 404, not a 403: telling a
 * caller "that id is real, just not yours" is a way to enumerate other people's ids.
 */
export async function findGeneration(
  db: Database,
  userId: string,
  id: string,
): Promise<GenerationRow> {
  const [row] = await db
    .select()
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)))
    .limit(1);
  if (!row) throw new ApiError("not_found", "No such generation.");
  return row;
}

/** Owner-scoped, like every other write here: an id alone is not authorisation. */
export async function deleteGeneration(
  db: Database,
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)));
}

/** `createdAt:id`, base64 — opaque to the client, and stable across inserts. */
function encodeCursor(row: GenerationRow): string {
  return btoa(`${row.createdAt.getTime()}:${row.id}`);
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [millis, id] = atob(cursor).split(":");
    const createdAt = new Date(Number(millis));
    if (!id || Number.isNaN(createdAt.getTime())) throw new Error("malformed");
    return { createdAt, id };
  } catch {
    throw new ApiError("invalid_request", "The `cursor` is not a valid cursor.");
  }
}

export async function listGenerations(
  db: Database,
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<{ rows: GenerationRow[]; nextCursor: string | null }> {
  const after = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = await db
    .select()
    .from(generation)
    .where(
      after
        ? and(
            eq(generation.userId, userId),
            // Ties on `createdAt` are broken by id, so a page boundary never
            // repeats a row or skips one when two rows share a millisecond.
            or(
              lt(generation.createdAt, after.createdAt),
              and(
                eq(generation.createdAt, after.createdAt),
                lt(generation.id, after.id),
              ),
            ),
          )
        : eq(generation.userId, userId),
    )
    .orderBy(desc(generation.createdAt), desc(generation.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
  };
}
