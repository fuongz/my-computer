import { safeImageContentType } from "@fuongz/auth";
import { createFileRoute } from "@tanstack/react-router";
import { findOwnedGeneration } from "#/server/core/generations";
import { serverEnv } from "#/server/core/env";
import { requireUserId } from "#/server/core/session";

/**
 * A stored generated image, for this app's own pages.
 *
 * The gallery cannot point an `<img>` at apps/api without putting an API key in the
 * browser, so this app serves its own bytes from the same bucket — behind the session
 * it already has. An id belonging to somebody else is a 404, never a 403.
 */
export const Route = createFileRoute("/api/generations/$id/image")({
  server: {
    handlers: {
      GET: async ({ params }): Promise<Response> => {
        let userId: string;
        try {
          userId = await requireUserId();
        } catch {
          return new Response("Not signed in.", { status: 401 });
        }

        const row = await findOwnedGeneration(userId, params.id);
        if (!row?.outputKey) return new Response("Not found.", { status: 404 });

        const env = await serverEnv();
        const object = await env.OUTPUTS.get(row.outputKey);
        if (!object) return new Response("Not found.", { status: 404 });

        return new Response(object.body as unknown as BodyInit, {
          headers: {
            // Narrowed to a known image type, and never sniffed past it. This is the
            // one route that serves provider-derived bytes from the app's own origin,
            // where the session cookie lives — a reflected `text/html` here would run
            // as first-party script.
            "Content-Type": safeImageContentType(row.outputContentType),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            // One user's own image, immutable once written. Never a shared cache.
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Length": String(object.size),
          },
        });
      },
    },
  },
});
