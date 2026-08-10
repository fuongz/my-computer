/**
 * The whole flow, end to end, with stubbed providers and a stubbed bucket:
 * analyse → generate → poll → retained (or deliberately not) → counted in usage.
 *
 * The parts worth a test here are the ones that only show up when the pieces meet:
 * that a retained generation ends up as OUR bytes and an unretained one never touches
 * the bucket, that a client giving up mid-poll leaves the row finishable, and that a
 * failed upstream gives back an allowance unit while a rejected prompt does not.
 */
import { apikey, user } from "@fuongz/auth/schema";
import path from "node:path";
import app from "../src/index";
import type { Env } from "../src/lib/env";
import { readAllowance } from "../src/services/allowance";
import { database } from "../src/services/db";
import { createTestDatabase } from "./d1-sqlite";
import {
  STUB_ANALYSIS_COST_USD,
  STUB_OUTPUT_URL,
  STUB_PROMPT,
  stubProviders,
  stubR2,
} from "./stubs";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const store = createTestDatabase(repoRoot);
const bucket = stubR2();
const providers = stubProviders();
providers.install();

const env: Env = {
  DB: store.binding,
  OUTPUTS: bucket.bucket,
  BETTER_AUTH_URL: "http://localhost:5174",
  BETTER_AUTH_SECRET: "flow-test-secret-not-a-real-one",
  PROVIDER_ENCRYPTION_KEY: btoa("0123456789abcdef0123456789abcdef"),
  SYSTEM_OPENROUTER_API_KEY: "system-openrouter-key",
  SYSTEM_REPLICATE_API_TOKEN: "system-replicate-token",
  // Generous on purpose: the ceilings themselves are tested in test-api.ts, and a
  // limit that bites here would fail a later check for an unrelated reason.
  DEFAULT_DAILY_ANALYSES: "50",
  DEFAULT_DAILY_IMAGES: "50",
  SYSTEM_DAILY_ANALYSES: "500",
  SYSTEM_DAILY_IMAGES: "500",
  ALLOWED_ORIGINS: "",
};

const db = database(env);

async function hashKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function seed(id: string, rawKey: string): Promise<void> {
  const now = new Date();
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(apikey).values({
    id: `key_${id}`,
    configId: "default",
    name: id,
    referenceId: id,
    prefix: "fz_",
    key: await hashKey(rawKey),
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: 200,
    requestCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

const OWNER_KEY = "fz_owner_flow_key";
const OTHER_KEY = "fz_other_flow_key";
await seed("user_owner", OWNER_KEY);
await seed("user_other", OTHER_KEY);

type Json = Record<string, unknown>;

async function api(
  method: string,
  pathname: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; contentType: string; body: Json }> {
  const response = await app.fetch(
    new Request(`http://api.test${pathname}`, {
      method,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    env,
  );
  // Read status and headers before the body: `clone()` would drag two different
  // libraries' Response types into the same expression.
  const status = response.status;
  const contentType = response.headers.get("Content-Type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as Json)
    : {};
  return { status, contentType, body };
}

// ── analysis, retained ──────────────────────────────────────────────────────────
{
  const response = await api("POST", "/v1/analyses", {
    token: OWNER_KEY,
    body: { imageUrl: "https://example.test/photo.jpg", store: true },
  });
  const generation = response.body.generation as Json;
  assert(response.status === 200, "an analysis answers synchronously");
  assert(response.body.prompt === STUB_PROMPT, "the caller gets the prompt");
  assert(generation.status === "succeeded", "the row is terminal immediately");
  assert(generation.mode === "default", "no stored key ⇒ the system key paid");
  assert(generation.retained === true, "store:true retains");
  assert(generation.prompt === STUB_PROMPT, "a retained analysis keeps its prompt");
  assert(
    generation.costMicroUsd === Math.round(STUB_ANALYSIS_COST_USD * 1_000_000),
    `the provider's own cost is stored exactly, got ${String(generation.costMicroUsd)}`,
  );
  assert(generation.costSource === "provider", "a provider-reported cost says so");

  const allowance = await readAllowance(db, env, "user_owner");
  assert(allowance.analyses.used === 1, "Default mode consumes one analysis");
}

// ── analysis, not retained ──────────────────────────────────────────────────────
{
  const response = await api("POST", "/v1/analyses", {
    token: OWNER_KEY,
    body: { imageUrl: "https://example.test/photo.jpg", store: false },
  });
  const generation = response.body.generation as Json;
  assert(response.body.prompt === STUB_PROMPT, "the prompt is returned either way");
  assert(generation.retained === false, "store:false does not retain");
  assert(generation.prompt === null, "an unretained analysis keeps no prompt");
  assert(generation.sourceImageUrl === null, "nor what it was made from");
  assert(
    generation.costMicroUsd !== null,
    "the audit half of the row is recorded regardless",
  );
}

// ── the input is validated before anything is spent ─────────────────────────────
{
  const before = await readAllowance(db, env, "user_owner");
  const response = await api("POST", "/v1/analyses", {
    token: OWNER_KEY,
    body: { imageUrl: "ftp://example.test/photo.jpg" },
  });
  assert(response.status === 400, "a non-http URL is rejected");
  const after = await readAllowance(db, env, "user_owner");
  assert(
    after.analyses.used === before.analyses.used,
    "a rejected request costs no allowance",
  );
}

// ── an upstream failure refunds; a rejected input does not ──────────────────────
{
  const before = await readAllowance(db, env, "user_owner");

  providers.failNextAnalysis(500);
  const down = await api("POST", "/v1/analyses", {
    token: OWNER_KEY,
    body: { imageUrl: "https://example.test/photo.jpg" },
  });
  assert(down.status === 502, "an upstream 5xx surfaces as a provider failure");
  const afterDown = await readAllowance(db, env, "user_owner");
  assert(
    afterDown.analyses.used === before.analyses.used,
    "a failure that was not the caller's refunds the unit",
  );

  providers.failNextAnalysis(400);
  const refused = await api("POST", "/v1/analyses", {
    token: OWNER_KEY,
    body: { imageUrl: "https://example.test/photo.jpg" },
  });
  assert(refused.status === 400, "an upstream input rejection is a 400, not a 502");
  const afterRefused = await readAllowance(db, env, "user_owner");
  assert(
    afterRefused.analyses.used === before.analyses.used + 1,
    "a rejection the caller caused keeps its unit — no free retries",
  );
}

// ── image: written as processing, finished by the poll, stored in R2 ────────────
let retainedId = "";
{
  providers.scriptPrediction({ statuses: ["processing", "succeeded"] });
  const created = await api("POST", "/v1/images", {
    token: OWNER_KEY,
    body: { prompt: "a still life", store: true },
  });
  const generation = created.body.generation as Json;
  retainedId = String(generation.id);

  assert(created.status === 202, "an image is accepted, not awaited");
  assert(generation.status === "processing", "the row exists before the image does");
  assert(generation.costMicroUsd === 11_000, "an image is priced up front from the table");
  assert(generation.costSource === "estimate", "a locally priced row says it is an estimate");
  assert(bucket.keys().length === 0, "nothing is stored until there is an image");

  const first = await api("GET", `/v1/generations/${retainedId}`, { token: OWNER_KEY });
  assert(
    (first.body.generation as Json).status === "processing",
    "a poll while the prediction runs reports it still running",
  );

  const second = await api("GET", `/v1/generations/${retainedId}`, { token: OWNER_KEY });
  const settled = second.body.generation as Json;
  assert(settled.status === "succeeded", "the poll finishes the row");
  assert(
    String(settled.imageUrl).endsWith(`/v1/generations/${retainedId}/image`),
    "a retained image is served from our own route, not the provider's",
  );
  assert(bucket.keys().length === 1, "a retained image is copied into R2");

  const bytes = await api("GET", `/v1/generations/${retainedId}/image`, { token: OWNER_KEY });
  assert(bytes.status === 200, "the stored image is readable by its owner");
  assert(
    bytes.contentType === "image/webp",
    "the stored content type is served back",
  );
}

// ── image, not retained: the bucket stays empty, the provider URL is handed back ─
{
  const storedBefore = bucket.keys().length;
  providers.scriptPrediction({ statuses: ["succeeded"] });
  const created = await api("POST", "/v1/images", {
    token: OWNER_KEY,
    body: { prompt: "a still life", store: false },
  });
  const id = String((created.body.generation as Json).id);

  const settled = await api("GET", `/v1/generations/${id}`, { token: OWNER_KEY });
  const generation = settled.body.generation as Json;
  assert(generation.status === "succeeded", "an unretained image still completes");
  assert(
    generation.imageUrl === STUB_OUTPUT_URL,
    "an unretained image comes back as the provider's own short-lived URL",
  );
  assert(generation.prompt === null, "an unretained image keeps no prompt");
  assert(
    bucket.keys().length === storedBefore,
    "an unretained image is never written to R2",
  );

  const bytes = await api("GET", `/v1/generations/${id}/image`, { token: OWNER_KEY });
  assert(bytes.status === 404, "there are no bytes of ours to serve for it");
}

// ── giving up mid-poll leaves the row finishable ────────────────────────────────
{
  providers.scriptPrediction({ statuses: ["processing", "processing", "succeeded"] });
  const created = await api("POST", "/v1/images", {
    token: OWNER_KEY,
    body: { prompt: "a slow one", store: true },
  });
  const id = String((created.body.generation as Json).id);

  // The client polls twice and gives up — the UI shows a timeout and writes nothing.
  await api("GET", `/v1/generations/${id}`, { token: OWNER_KEY });
  await api("GET", `/v1/generations/${id}`, { token: OWNER_KEY });

  const abandoned = await api("GET", `/v1/generations/${id}`, { token: OWNER_KEY });
  assert(
    (abandoned.body.generation as Json).status === "succeeded",
    "a row abandoned by its client is still finished by the next view",
  );

  const listed = await api("GET", "/v1/generations?limit=50", { token: OWNER_KEY });
  const generations = listed.body.generations as Json[];
  assert(
    generations.every((row) => row.status !== "processing"),
    "the gallery has no permanent ghosts",
  );
}

// ── a failed prediction records the failure and drops the estimated cost ────────
{
  providers.scriptPrediction({ statuses: ["failed"], error: "the model refused" });
  const created = await api("POST", "/v1/images", {
    token: OWNER_KEY,
    body: { prompt: "a doomed one", store: true },
  });
  assert(created.status === 202, "the doomed prediction was accepted");
  const id = String((created.body.generation as Json).id);

  const settled = await api("GET", `/v1/generations/${id}`, { token: OWNER_KEY });
  const generation = settled.body.generation as Json;
  assert(generation.status === "failed", "a failed prediction is recorded as failed");
  assert(
    (generation.error as Json | null)?.message === "the model refused",
    "the upstream reason is kept for the audit row",
  );
  assert(
    generation.costMicroUsd === null,
    "an image that was never produced does not keep the price of one",
  );
}

// ── one account cannot reach another's generations ──────────────────────────────
{
  const storedBefore = bucket.keys().length;
  const theirs = await api("GET", `/v1/generations/${retainedId}`, { token: OTHER_KEY });
  assert(theirs.status === 404, "someone else's id is a 404, not a 403");

  const theirBytes = await api("GET", `/v1/generations/${retainedId}/image`, {
    token: OTHER_KEY,
  });
  assert(theirBytes.status === 404, "nor can they read the bytes");

  const theirList = await api("GET", "/v1/generations", { token: OTHER_KEY });
  assert(
    (theirList.body.generations as Json[]).length === 0,
    "a list only ever contains the caller's own rows",
  );

  const theirDelete = await api("DELETE", `/v1/generations/${retainedId}`, {
    token: OTHER_KEY,
  });
  assert(theirDelete.status === 404, "nor can they delete it");
  assert(
    bucket.keys().length === storedBefore,
    "a refused delete removes nothing",
  );
}

// ── usage reports the ledger and the allowance together ────────────────────────
{
  const usage = await api("GET", "/v1/usage", { token: OWNER_KEY });
  const spend = usage.body.spend as { today: { totalCostMicroUsd: number; byProviderAndMode: Json[] } };
  const allowance = usage.body.allowance as { analyses: { used: number } };

  assert(spend.today.totalCostMicroUsd > 0, "the day's spend is summed");
  assert(
    spend.today.byProviderAndMode.some((line) => line.provider === "replicate"),
    "spend is broken down by provider",
  );
  assert(allowance.analyses.used > 0, "the allowance is reported alongside it");
}

// ── deleting removes the row and its bytes ──────────────────────────────────────
{
  const deleted = await api("DELETE", `/v1/generations/${retainedId}`, { token: OWNER_KEY });
  assert(deleted.status === 204, "an owner can delete their own generation");
  assert(
    !bucket.keys().some((key) => key.includes(retainedId)),
    "deleting takes the stored object with it",
  );

  const gone = await api("GET", `/v1/generations/${retainedId}`, { token: OWNER_KEY });
  assert(gone.status === 404, "the row is gone too");
}

providers.restore();
store.close();
console.log("generation flow checks passed");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
