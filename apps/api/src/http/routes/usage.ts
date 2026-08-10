import { Hono } from "hono";
import type { ApiBindings } from "#/http/auth";
import { microToUsd } from "#/lib/pricing";
import { readAllowance } from "#/services/allowance";
import { database } from "#/services/db";
import { spendSince } from "#/services/spend";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Two different questions, deliberately in one place.
 *
 * The allowance is a limit — it says what will be refused. The spend is a record — it
 * says what has been paid for and by whom, and nothing about it blocks anything. A
 * client that shows only one of them tells its user half the truth about their costs.
 */
export const usageRoutes = new Hono<ApiBindings>().get("/", async (c) => {
  const caller = c.get("caller");
  const db = database(c.env);
  const now = new Date();

  const [allowance, today, month] = await Promise.all([
    readAllowance(db, c.env, caller.userId, now),
    spendSince(db, caller.userId, new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)),
    spendSince(db, caller.userId, new Date(now.getTime() - THIRTY_DAYS_MS)),
  ]);

  return c.json({
    allowance,
    spend: {
      // USD alongside micro-USD so a client never has to divide by a million and
      // guess the rounding — and so the exact integer is still there to sum.
      today: { ...today, totalUsd: microToUsd(today.totalCostMicroUsd) },
      last30Days: { ...month, totalUsd: microToUsd(month.totalCostMicroUsd) },
    },
  });
});
