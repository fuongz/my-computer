import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "#/server/auth/core";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }): Promise<Response> => (await getAuth()).handler(request),
      POST: async ({ request }): Promise<Response> => (await getAuth()).handler(request),
    },
  },
});
