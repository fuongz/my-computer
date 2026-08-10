import { ALLOWANCE_LIMIT_MAX } from "@fuongz/auth";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "#/http/admin";
import type { ApiBindings } from "#/http/auth";
import { parseBody, parseLimit } from "#/http/validate";
import { database } from "#/services/db";
import {
  clearAccountAllowance,
  listAccountAllowances,
  resetAccountUsage,
  setAccountAllowance,
} from "#/services/admin";

/**
 * A limit, or `null` to follow the deployment default.
 *
 * Bounded and integral: the read path clamps a nonsense value defensively, but a
 * request asking for one should be told it was nonsense rather than quietly corrected.
 */
const Limit = z.number().int().min(0).max(ALLOWANCE_LIMIT_MAX).nullable();

const AllowanceRequest = z.object({
  analysesLimit: Limit,
  imagesLimit: Limit,
  note: z.string().max(200).nullish(),
  /** Also wipe today's counters, for "they hit the wall and need to work now". */
  resetToday: z.boolean().default(false),
});

export const adminRoutes = new Hono<ApiBindings>()
  .use("*", requireAdmin())
  .get("/users", async (c) => {
    const accounts = await listAccountAllowances(
      database(c.env),
      c.env,
      parseLimit(c.req.query("limit"), 100, 500),
    );
    return c.json({ accounts });
  })
  .put("/users/:id/allowance", async (c) => {
    const db = database(c.env);
    const body = await parseBody(c, AllowanceRequest);
    const userId = c.req.param("id");

    await setAccountAllowance(db, userId, body);
    if (body.resetToday) await resetAccountUsage(db, userId);

    const accounts = await listAccountAllowances(db, c.env, 500);
    return c.json({
      account: accounts.find((account) => account.userId === userId) ?? null,
    });
  })
  .delete("/users/:id/allowance", async (c) => {
    await clearAccountAllowance(database(c.env), c.req.param("id"));
    return c.body(null, 204);
  });
