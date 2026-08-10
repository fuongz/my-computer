import { isAdminEmail, parseAdminEmails } from "@fuongz/auth";
import { and, desc, eq } from "drizzle-orm";
import { dailyAllowance, user, userAllowance } from "#/server/db/schema";
import { database, serverEnv } from "#/server/core/env";
import { requireUserId } from "#/server/core/session";

/**
 * Whether the signed-in user is on the deployment's admin allowlist.
 *
 * The allowlist is an environment variable, not a column — see the note in
 * `@fuongz/auth`'s admin module. An empty allowlist means nobody, so the default
 * state of a fresh deployment is closed.
 */
export async function currentUserIsAdmin(): Promise<boolean> {
  const env = (await serverEnv()) as Awaited<ReturnType<typeof serverEnv>> & {
    ADMIN_EMAILS?: string;
  };
  const allowlist = parseAdminEmails(env.ADMIN_EMAILS);
  if (allowlist.length === 0) return false;

  const db = await database();
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, await requireUserId()))
    .limit(1);
  return isAdminEmail(allowlist, account?.email);
}

/** Every server function below starts here. A page guard is not an access control. */
async function requireAdmin(): Promise<void> {
  if (!(await currentUserIsAdmin())) {
    throw new Error("This page is for administrators.");
  }
}

export interface AccountAllowance {
  userId: string;
  email: string;
  name: string;
  analyses: { limit: number; used: number; source: "default" | "override" };
  images: { limit: number; used: number; source: "default" | "override" };
  note: string | null;
}

function envCount(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function listAccounts(limit = 200): Promise<AccountAllowance[]> {
  await requireAdmin();
  const env = (await serverEnv()) as Env & Record<string, string | undefined>;
  const db = await database();
  const day = new Date().toISOString().slice(0, 10);
  const defaults = {
    analyses: envCount(env.DEFAULT_DAILY_ANALYSES, 5),
    images: envCount(env.DEFAULT_DAILY_IMAGES, 1),
  };

  const accounts = await db
    .select({ id: user.id, email: user.email, name: user.name })
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

export async function setAccountAllowance(input: {
  userId: string;
  analysesLimit: number | null;
  imagesLimit: number | null;
  note: string | null;
  resetToday: boolean;
}): Promise<void> {
  await requireAdmin();
  const db = await database();

  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!target) throw new Error("No such account.");

  // An override that overrides nothing is noise — drop the row instead of keeping it.
  if (input.analysesLimit === null && input.imagesLimit === null) {
    await db.delete(userAllowance).where(eq(userAllowance.userId, input.userId));
  } else {
    const values = {
      analysesLimit: input.analysesLimit,
      imagesLimit: input.imagesLimit,
      note: input.note,
      updatedAt: new Date(),
    };
    await db
      .insert(userAllowance)
      .values({ userId: input.userId, ...values })
      .onConflictDoUpdate({ target: userAllowance.userId, set: values });
  }

  if (input.resetToday) {
    const day = new Date().toISOString().slice(0, 10);
    await db
      .delete(dailyAllowance)
      .where(
        and(eq(dailyAllowance.userId, input.userId), eq(dailyAllowance.day, day)),
      );
  }
}
