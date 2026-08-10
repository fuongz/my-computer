import { Hono } from "hono";
import { cors } from "hono/cors";
import { type ApiBindings, requireApiKey } from "#/http/auth";
import { adminRoutes } from "#/http/routes/admin";
import { analysisRoutes } from "#/http/routes/analyses";
import { generationRoutes } from "#/http/routes/generations";
import { imageRoutes } from "#/http/routes/images";
import { meRoutes } from "#/http/routes/me";
import { usageRoutes } from "#/http/routes/usage";
import { allowedOrigins } from "#/lib/env";
import { ApiError, errorBody } from "#/lib/errors";

const app = new Hono<ApiBindings>();

// An explicit allowlist, read per request because it comes from the environment.
// The extension's service worker needs none of this — it has host access — so an
// empty list is the correct default rather than a misconfiguration.
app.use("/v1/*", (c, next) => {
  const origins = allowedOrigins(c.env);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: false,
  })(c, next);
});

/**
 * The routes that may be reached without a key. Everything else under /v1 requires
 * one.
 *
 * An explicit list, checked inside the guard, rather than relying on this `use` being
 * registered after the public routes and before the private ones: security that
 * depends on the order lines appear in this file is security that a later edit
 * silently removes.
 */
const PUBLIC_PATHS = new Set(["/v1/health"]);

app.use("/v1/*", (c, next) =>
  PUBLIC_PATHS.has(c.req.path) ? next() : requireApiKey()(c, next),
);

app.get("/v1/health", (c) => c.json({ status: "ok" }));
app.route("/v1/me", meRoutes);
app.route("/v1/analyses", analysisRoutes);
app.route("/v1/images", imageRoutes);
app.route("/v1/generations", generationRoutes);
app.route("/v1/usage", usageRoutes);
// Admin-only, guarded inside the router itself so mounting it cannot forget the check.
app.route("/v1/admin", adminRoutes);

app.notFound((c) =>
  c.json(errorBody(new ApiError("not_found", "No such endpoint.")), 404),
);

// One place turns a thrown failure into the response envelope, so no route has to
// remember the shape — and an unexpected error can never leak a stack or a message
// that was written for us rather than for a caller.
app.onError((error, c) => {
  if (error instanceof ApiError) {
    const headers = error.retryAfterSeconds
      ? { "Retry-After": String(error.retryAfterSeconds) }
      : undefined;
    return c.json(errorBody(error), error.status, headers);
  }
  console.error("unhandled error", error);
  return c.json(
    errorBody(new ApiError("internal", "Something went wrong on our side.")),
    500,
  );
});

export default app;
