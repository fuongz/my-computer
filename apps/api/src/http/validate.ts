import type { Context } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "#/lib/errors";

/**
 * Parse and bound a JSON body before anything else happens to it.
 *
 * Every route validates before it consumes allowance or calls a provider, so a
 * malformed request costs nothing and reaches nothing.
 */
export async function parseBody<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("invalid_request", "The request body must be JSON.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "The request body is not valid.", {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

/** A positive integer query parameter, clamped — never a client-chosen page size. */
export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
