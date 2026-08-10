import { safeImageContentType } from "@fuongz/auth";
import {
  ProviderError,
  deleteOutput,
  readOutput,
  reconcileGeneration,
  reconcileMany,
} from "@fuongz/generation";
import { Hono } from "hono";
import type { ApiBindings } from "#/http/auth";
import { parseLimit } from "#/http/validate";
import { ApiError } from "#/lib/errors";
import { providerApiError } from "#/lib/provider-error";
import { database } from "#/services/db";
import {
  deleteGeneration,
  findGeneration,
  listGenerations,
  viewOf,
} from "#/services/generations";
import { reconcileContext } from "#/services/reconcile-context";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * How many still-running rows one list request will chase.
 *
 * A page of twenty `processing` rows must not become twenty upstream calls, but a
 * gallery that never reconciles leaves permanent ghosts. Bounded, and best-effort.
 */
const MAX_RECONCILES_PER_LIST = 5;

export const generationRoutes = new Hono<ApiBindings>()
  .get("/", async (c) => {
    const caller = c.get("caller");
    const db = database(c.env);
    const origin = new URL(c.req.url).origin;

    const page = await listGenerations(db, caller.userId, {
      limit: parseLimit(c.req.query("limit"), DEFAULT_LIMIT, MAX_LIMIT),
      cursor: c.req.query("cursor"),
    });

    const settled = await reconcileMany(
      reconcileContext(db, c.env),
      page.rows,
      MAX_RECONCILES_PER_LIST,
    );

    return c.json({
      generations: settled.map((item) =>
        viewOf(item.row, { origin, transientImageUrl: item.transientImageUrl }),
      ),
      nextCursor: page.nextCursor,
    });
  })
  .get("/:id", async (c) => {
    const caller = c.get("caller");
    const db = database(c.env);
    const origin = new URL(c.req.url).origin;

    const row = await findGeneration(db, caller.userId, c.req.param("id"));
    try {
      const settled = await reconcileGeneration(reconcileContext(db, c.env), row);
      return c.json({
        generation: viewOf(settled.row, {
          origin,
          transientImageUrl: settled.transientImageUrl,
        }),
      });
    } catch (error) {
      // The row keeps saying `processing`, so a later poll can still finish it.
      if (error instanceof ProviderError) throw providerApiError(error);
      throw error;
    }
  })
  .get("/:id/image", async (c) => {
    const caller = c.get("caller");
    const db = database(c.env);

    const row = await findGeneration(db, caller.userId, c.req.param("id"));
    if (!row.outputKey) {
      throw new ApiError(
        "not_found",
        row.retained
          ? "This generation has no stored image yet."
          : "This generation was not retained, so there is no stored image.",
      );
    }

    const object = await readOutput(c.env.OUTPUTS, row.outputKey);
    if (!object) {
      throw new ApiError("not_found", "The stored image is no longer available.");
    }

    return new Response(object.body, {
      headers: {
        // Narrowed to a known image type, and never sniffed past it: these bytes came
        // from a provider, and this response is served from our own origin.
        "Content-Type": safeImageContentType(row.outputContentType),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        // One caller's own image, immutable once written. Never a shared cache.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(object.size),
      },
    });
  })
  .delete("/:id", async (c) => {
    const caller = c.get("caller");
    const db = database(c.env);

    const row = await findGeneration(db, caller.userId, c.req.param("id"));
    // The object first: a row deleted while its bytes survive leaves an object that
    // nothing points at any more, and nothing left to find it by.
    if (row.outputKey) await deleteOutput(c.env.OUTPUTS, row.outputKey);
    await deleteGeneration(db, caller.userId, row.id);

    return c.body(null, 204);
  });
