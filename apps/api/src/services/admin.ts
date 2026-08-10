import { dailyAllowance, user, userAllowance } from "@fuongz/auth/schema";
import { and, desc, eq } from "drizzle-orm";
import { type Env, userLimits } from "#/lib/env";
import { ApiError } from "#/lib/errors";
import { utcDay } from "#/lib/time";
import type { Database } from "#/services/db";

export interface AccountAllowance {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  /** The ceiling in force, and whether it is this account's own or the default. */
  analyses: { limit: number; used: number; source: "default" | "override" };
  images: { limit: number; used: number; source: "default" | "override" };
  note: string | null;
}

/**
 * Every account with its effective limits and today's usage.
 *
 * One query per table rather than a three-way join: the account list is small, and a
 * join with two optional sides is harder to read than two maps.
 */
export async function listAccountAllowances(
  db: Database,
  env: Env,
  limit: number,
): Promise<AccountAllowance[]> {
  const day = utcDay(new Date());
  const defaults = userLimits(env);

  const accounts = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(limit);

  const overrides = new Map(
    (
      await db
        .select({
          userId: userAllowance.userId,
          analysesLimit: userAllowance.analysesLimit,
          imagesLimit: userAllowance.imagesLimit,
          note: userAllowance.note,
        })
        .from(userAllowance)
    ).map((row) => [row.userId, row]),
  );

  const used = new Map(
    (
      await db
        .select({
          userId: dailyAllowance.userId,
          analysesUsed: dailyAllowance.analysesUsed,
          imagesUsed: dailyAllowance.imagesUsed,
        })
        .from(dailyAllowance)
        .where(eq(dailyAllowance.day, day))
    ).map((row) => [row.userId, row]),
  );

  return accounts.map((account) => {
    const override = overrides.get(account.id);
    const today = used.get(account.id);
    return {
      userId: account.id,
      email: account.email,
      name: account.name,
      createdAt: account.createdAt.toISOString(),
      analyses: {
        limit: override?.analysesLimit ?? defaults.analyses,
        used: today?.analysesUsed ?? 0,
        source: override?.analysesLimit == null ? "default" : "override",
      },
      images: {
        limit: override?.imagesLimit ?? defaults.images,
        used: today?.imagesUsed ?? 0,
        source: override?.imagesLimit == null ? "default" : "override",
      },
      note: override?.note ?? null,
    };
  });
}

/**
 * Set (or clear) one account's override.
 *
 * `null` on a column means "follow the deployment default", which is how a limit is
 * raised for one dimension without pinning the other. A row where BOTH columns are
 * null is deleted rather than kept — an override that overrides nothing is noise.
 */
export async function setAccountAllowance(
  db: Database,
  userId: string,
  input: {
    analysesLimit: number | null;
    imagesLimit: number | null;
    note?: string | null;
  },
): Promise<void> {
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) throw new ApiError("not_found", "No such account.");

  if (input.analysesLimit === null && input.imagesLimit === null) {
    await clearAccountAllowance(db, userId);
    return;
  }

  await db
    .insert(userAllowance)
    .values({
      userId,
      analysesLimit: input.analysesLimit,
      imagesLimit: input.imagesLimit,
      note: input.note ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userAllowance.userId,
      set: {
        analysesLimit: input.analysesLimit,
        imagesLimit: input.imagesLimit,
        note: input.note ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function clearAccountAllowance(
  db: Database,
  userId: string,
): Promise<void> {
  await db.delete(userAllowance).where(eq(userAllowance.userId, userId));
}

/**
 * Give an account a fresh day immediately.
 *
 * Raising a limit does not touch what has already been spent, so "they hit the wall
 * and I want them working now" needs this as well.
 */
export async function resetAccountUsage(
  db: Database,
  userId: string,
): Promise<void> {
  const day = utcDay(new Date());
  await db
    .delete(dailyAllowance)
    .where(and(eq(dailyAllowance.userId, userId), eq(dailyAllowance.day, day)));
}
