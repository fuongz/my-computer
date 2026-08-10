import {
  dailyAllowance,
  systemAllowance,
  userAllowance,
} from "@fuongz/auth/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Env, systemLimits, userLimits } from "#/lib/env";
import { ApiError } from "#/lib/errors";
import { nextUtcMidnight, secondsUntil, utcDay } from "#/lib/time";
import type { Database } from "#/services/db";

export type AllowanceUnit = "analyses" | "images";

export interface AllowanceCounter {
  limit: number;
  used: number;
  remaining: number;
  /** Whether this ceiling came from the deployment default or this account's override. */
  source: "default" | "override";
}

export interface AllowanceState {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** ISO instant this period ends. */
  resetsAt: string;
  analyses: AllowanceCounter;
  images: AllowanceCounter;
  /** True when the deployment ceiling is spent — Default is refused, BYOK is not. */
  systemCeilingReached: boolean;
}

export interface EffectiveLimits {
  analyses: number;
  images: number;
  analysesSource: "default" | "override";
  imagesSource: "default" | "override";
}

/**
 * The ceilings that apply to ONE account.
 *
 * A `user_allowance` row overrides the deployment default per column, so raising one
 * person's image limit leaves their analysis limit tracking the default. Null means
 * "use the default"; zero is a real ceiling and means zero. Negatives are clamped —
 * a typo in a hand-written SQL update should not mint allowance.
 */
export async function limitsFor(
  db: Database,
  env: Env,
  userId: string,
): Promise<EffectiveLimits> {
  const defaults = userLimits(env);
  const [override] = await db
    .select({
      analysesLimit: userAllowance.analysesLimit,
      imagesLimit: userAllowance.imagesLimit,
    })
    .from(userAllowance)
    .where(eq(userAllowance.userId, userId))
    .limit(1);

  const pick = (
    value: number | null | undefined,
    fallback: number,
  ): [number, "default" | "override"] =>
    value === null || value === undefined
      ? [fallback, "default"]
      : [Math.max(0, value), "override"];

  const [analyses, analysesSource] = pick(override?.analysesLimit, defaults.analyses);
  const [images, imagesSource] = pick(override?.imagesLimit, defaults.images);
  return { analyses, images, analysesSource, imagesSource };
}

function exhausted(unit: AllowanceUnit, at: Date): ApiError {
  const resetsAt = nextUtcMidnight(at);
  return new ApiError(
    "allowance_exhausted",
    `You have used today's free ${unit === "analyses" ? "analyses" : "image generations"}. Add your own provider key to lift the limit, or wait for the daily reset.`,
    {
      retryAfterSeconds: secondsUntil(resetsAt, at),
      details: { unit, resetsAt: resetsAt.toISOString() },
    },
  );
}

/**
 * Take one unit of the caller's free allowance, and one of the deployment's.
 *
 * Each counter moves in a SINGLE conditional upsert whose `RETURNING` clause is the
 * answer: SQLite emits a row only when it actually inserted or updated, so "no row
 * back" means "the ceiling refused this". Reading a count and then writing it would
 * let two concurrent requests both see room for the last unit — the failure that
 * stays invisible until somebody double-clicks.
 *
 * Call this BEFORE the upstream request, and {@link refundAllowance} if the call
 * then fails for a reason that was not the caller's fault.
 */
export async function consumeAllowance(
  db: Database,
  env: Env,
  userId: string,
  unit: AllowanceUnit,
  at: Date = new Date(),
): Promise<void> {
  const day = utcDay(at);
  const perUser = (await limitsFor(db, env, userId))[unit];
  if (perUser <= 0) throw exhausted(unit, at);

  const userRows = await db
    .insert(dailyAllowance)
    .values({
      userId,
      day,
      analysesUsed: unit === "analyses" ? 1 : 0,
      imagesUsed: unit === "images" ? 1 : 0,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [dailyAllowance.userId, dailyAllowance.day],
      set:
        unit === "analyses"
          ? { analysesUsed: sql`${dailyAllowance.analysesUsed} + 1`, updatedAt: at }
          : { imagesUsed: sql`${dailyAllowance.imagesUsed} + 1`, updatedAt: at },
      setWhere:
        unit === "analyses"
          ? lt(dailyAllowance.analysesUsed, perUser)
          : lt(dailyAllowance.imagesUsed, perUser),
    })
    .returning({ day: dailyAllowance.day });

  if (userRows.length === 0) throw exhausted(unit, at);

  const ceiling = systemLimits(env)[unit];
  const systemRows =
    ceiling <= 0
      ? []
      : await db
          .insert(systemAllowance)
          .values({
            day,
            analysesUsed: unit === "analyses" ? 1 : 0,
            imagesUsed: unit === "images" ? 1 : 0,
            updatedAt: at,
          })
          .onConflictDoUpdate({
            target: systemAllowance.day,
            set:
              unit === "analyses"
                ? {
                    analysesUsed: sql`${systemAllowance.analysesUsed} + 1`,
                    updatedAt: at,
                  }
                : {
                    imagesUsed: sql`${systemAllowance.imagesUsed} + 1`,
                    updatedAt: at,
                  },
            setWhere:
              unit === "analyses"
                ? lt(systemAllowance.analysesUsed, ceiling)
                : lt(systemAllowance.imagesUsed, ceiling),
          })
          .returning({ day: systemAllowance.day });

  if (systemRows.length === 0) {
    // The user had room; the deployment did not. Give back the user's unit — and ONLY
    // the user's. The shared counter refused this request, so it never incremented;
    // decrementing it here would hand back a unit that was never taken and let the
    // ceiling leak one request for every request it turned away.
    await refundUser(db, userId, unit, at);
    const resetsAt = nextUtcMidnight(at);
    throw new ApiError(
      "system_allowance_exhausted",
      "The shared free allowance for today is used up. Add your own provider key to keep going, or try again after the daily reset.",
      {
        retryAfterSeconds: secondsUntil(resetsAt, at),
        details: { unit, resetsAt: resetsAt.toISOString() },
      },
    );
  }
}

/** One counter, one direction. Clamped so a double refund cannot mint allowance. */
async function refundUser(
  db: Database,
  userId: string,
  unit: AllowanceUnit,
  at: Date,
): Promise<void> {
  const day = utcDay(at);
  await db
    .update(dailyAllowance)
    .set(
      unit === "analyses"
        ? {
            analysesUsed: sql`max(${dailyAllowance.analysesUsed} - 1, 0)`,
            updatedAt: at,
          }
        : {
            imagesUsed: sql`max(${dailyAllowance.imagesUsed} - 1, 0)`,
            updatedAt: at,
          },
    )
    .where(and(eq(dailyAllowance.userId, userId), eq(dailyAllowance.day, day)));
}

/**
 * Give back one unit that WAS consumed, on both counters.
 *
 * Only for failures that were not the caller's: an upstream 5xx, a network error, a
 * bug of ours. A rejected input keeps its unit — otherwise a malformed request is a
 * free retry. Never call this for a request that {@link consumeAllowance} refused;
 * that one already unwound whatever it took.
 */
export async function refundAllowance(
  db: Database,
  userId: string,
  unit: AllowanceUnit,
  at: Date = new Date(),
): Promise<void> {
  const day = utcDay(at);
  await refundUser(db, userId, unit, at);

  await db
    .update(systemAllowance)
    .set(
      unit === "analyses"
        ? {
            analysesUsed: sql`max(${systemAllowance.analysesUsed} - 1, 0)`,
            updatedAt: at,
          }
        : {
            imagesUsed: sql`max(${systemAllowance.imagesUsed} - 1, 0)`,
            updatedAt: at,
          },
    )
    .where(eq(systemAllowance.day, day));
}

/** What is left, without consuming anything — for `GET /v1/me` and `GET /v1/usage`. */
export async function readAllowance(
  db: Database,
  env: Env,
  userId: string,
  at: Date = new Date(),
): Promise<AllowanceState> {
  const day = utcDay(at);
  const perUser = await limitsFor(db, env, userId);
  const ceiling = systemLimits(env);

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

  const counter = (
    used: number,
    limit: number,
    source: "default" | "override",
  ): AllowanceCounter => ({
    limit,
    used,
    remaining: Math.max(0, limit - used),
    source,
  });

  return {
    day,
    resetsAt: nextUtcMidnight(at).toISOString(),
    analyses: counter(mine?.analysesUsed ?? 0, perUser.analyses, perUser.analysesSource),
    images: counter(mine?.imagesUsed ?? 0, perUser.images, perUser.imagesSource),
    systemCeilingReached:
      (shared?.analysesUsed ?? 0) >= ceiling.analyses ||
      (shared?.imagesUsed ?? 0) >= ceiling.images,
  };
}
