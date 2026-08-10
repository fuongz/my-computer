/**
 * Deterministic checks for the parts of the API that are invisible when they are
 * wrong: who a bearer token resolves to, whether one account can see another's, and
 * whether the free allowance can be spent past its ceiling.
 *
 * No wrangler, no network, no provider: the Hono app is invoked through `app.fetch`
 * with a SQLite-backed D1 binding, so every SQL statement really runs.
 */
import { sealSecret } from "@fuongz/auth";
import { apikey, providerCredential, user, userAllowance } from "@fuongz/auth/schema";
import path from "node:path";
import app from "../src/index";
import type { Env } from "../src/lib/env";
import { ApiError } from "../src/lib/errors";
import {
  consumeAllowance,
  limitsFor,
  readAllowance,
  refundAllowance,
} from "../src/services/allowance";
import { describeProviders, resolveCredential } from "../src/services/credentials";
import { database } from "../src/services/db";
import { createTestDatabase } from "./d1-sqlite";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const store = createTestDatabase(repoRoot);

// Base64 of 32 bytes — a fixed test value, never a real deployment key.
const ENCRYPTION_KEY = btoa("0123456789abcdef0123456789abcdef");

const env: Env = {
  DB: store.binding,
  OUTPUTS: {} as Env["OUTPUTS"],
  BETTER_AUTH_URL: "http://localhost:5174",
  BETTER_AUTH_SECRET: "test-secret-not-a-real-one",
  PROVIDER_ENCRYPTION_KEY: ENCRYPTION_KEY,
  SYSTEM_OPENROUTER_API_KEY: "system-openrouter-key",
  SYSTEM_REPLICATE_API_TOKEN: "system-replicate-token",
  DEFAULT_DAILY_ANALYSES: "5",
  DEFAULT_DAILY_IMAGES: "1",
  // Deliberately far out of the way: the per-user checks below must be refused by the
  // per-user ceiling, never incidentally by the shared one. The shared ceiling gets
  // its own check, on images, where 2 is exactly the number that makes it bite.
  SYSTEM_DAILY_ANALYSES: "100",
  SYSTEM_DAILY_IMAGES: "2",
  ALLOWED_ORIGINS: "",
};

// Built exactly the way the Worker builds it, schema included.
const db = database(env);

/**
 * The api-key plugin stores an unsalted SHA-256 of the key, base64url without
 * padding (`defaultKeyHasher`). Reproduced here so a test can mint a usable key
 * without standing up GitHub OAuth — this is the ONE place that is allowed to know
 * the storage format, and it is not shipped code.
 */
async function hashKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function seedUser(id: string, email: string): Promise<void> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedKey(id: string, raw: string, userId: string): Promise<void> {
  const now = new Date();
  await db.insert(apikey).values({
    id,
    configId: "default",
    name: `key for ${userId}`,
    start: raw.slice(0, 6),
    referenceId: userId,
    prefix: "fz_",
    key: await hashKey(raw),
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: 60,
    requestCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

const ALICE_KEY = "fz_alice_raw_key_value";
const BOB_KEY = "fz_bob_raw_key_value";

await seedUser("user_alice", "alice@example.test");
await seedUser("user_bob", "bob@example.test");
await seedKey("key_alice", ALICE_KEY, "user_alice");
await seedKey("key_bob", BOB_KEY, "user_bob");

const call = (pathname: string, token?: string) =>
  app.fetch(
    new Request(`http://api.test${pathname}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env,
  );

/** Same, with a method and body, and against an env the caller chooses. */
const send = (
  method: string,
  pathname: string,
  options: { token?: string; body?: unknown; env?: Env } = {},
) =>
  app.fetch(
    new Request(`http://api.test${pathname}`, {
      method,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    options.env ?? env,
  );

// ── the error envelope and the auth boundary ────────────────────────────────────
{
  const health = await call("/v1/health");
  assert(health.status === 200, "health is unauthenticated");

  const missing = await call("/v1/me");
  const missingBody = (await missing.json()) as {
    error: { code: string; message: string };
  };
  assert(missing.status === 401, "no bearer token is a 401");
  assert(missingBody.error.code === "unauthorized", "failures use the error envelope");

  const wrong = await call("/v1/me", "fz_not_a_real_key");
  const wrongBody = (await wrong.json()) as { error: { message: string } };
  assert(wrong.status === 401, "an unknown key is a 401");
  assert(
    wrongBody.error.message === missingBody.error.message,
    "a missing key and an unknown key are indistinguishable to the caller",
  );

  const unknownRoute = await call("/v1/nope", ALICE_KEY);
  assert(unknownRoute.status === 404, "an unknown route is a 404 in the envelope");
}

// ── a token resolves to exactly one account ─────────────────────────────────────
{
  const mine = await call("/v1/me", ALICE_KEY);
  const body = (await mine.json()) as {
    user: { id: string; email: string };
    providers: Record<string, { mode: string; last4: string | null }>;
    allowance: { analyses: { limit: number; remaining: number } };
  };
  assert(mine.status === 200, "a live key reaches /v1/me");
  assert(body.user.id === "user_alice", "the key resolves to its own account");
  assert(body.providers.openrouter.mode === "default", "no stored key ⇒ Default mode");
  assert(body.allowance.analyses.limit === 5, "the configured allowance is reported");
  assert(
    !JSON.stringify(body).includes("system-openrouter-key"),
    "no response ever contains a provider secret",
  );
  assert(
    !JSON.stringify(body).includes(ALICE_KEY),
    "no response ever echoes the API key back",
  );

  const theirs = await call("/v1/me", BOB_KEY);
  const theirBody = (await theirs.json()) as { user: { id: string } };
  assert(
    theirBody.user.id === "user_bob",
    "a different key resolves to a different account, not the first one seen",
  );
}

// ── BYOK: sealed at rest, opened only to make a call, never shown ───────────────
{
  const secret = "sk-or-alice-private-9876";
  const sealed = await sealSecret(ENCRYPTION_KEY, secret);
  assert(!sealed.ciphertext.includes("9876"), "the stored credential is not plaintext");

  await db.insert(providerCredential).values({
    id: "cred_alice_openrouter",
    userId: "user_alice",
    provider: "openrouter",
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    last4: "9876",
  });

  const resolved = await resolveCredential(db, env, "user_alice", "openrouter");
  assert(resolved.mode === "byok", "a stored credential switches that provider to BYOK");
  assert(resolved.secret === secret, "the credential round-trips through AES-GCM");

  const replicate = await resolveCredential(db, env, "user_alice", "replicate");
  assert(replicate.mode === "default", "mode is per provider, not per account");
  assert(replicate.secret === "system-replicate-token", "Default mode uses the system key");

  const bobs = await describeProviders(db, env, "user_bob");
  assert(bobs.openrouter.mode === "default", "one account cannot see another's credential");
  assert(bobs.openrouter.last4 === null, "no credential means no fingerprint");

  const bobResolved = await resolveCredential(db, env, "user_bob", "openrouter");
  assert(bobResolved.secret === "system-openrouter-key", "Bob gets the system key, not Alice's");

  const withoutSystem = await rejects(() =>
    resolveCredential(db, { ...env, SYSTEM_REPLICATE_API_TOKEN: "" }, "user_bob", "replicate"),
  );
  assert(
    withoutSystem.code === "provider_unavailable",
    "Default mode with no system key is a clear refusal, not a crash",
  );
}

// ── the allowance ceiling holds, including under concurrency ────────────────────
{
  const limits = { analyses: 5, images: 1 };
  for (let taken = 0; taken < limits.analyses; taken++) {
    await consumeAllowance(db, env, "user_bob", "analyses");
  }
  const overspent = await rejects(() => consumeAllowance(db, env, "user_bob", "analyses"));
  assert(overspent.code === "allowance_exhausted", "the 6th analysis of the day is refused");
  assert(
    (overspent.retryAfterSeconds ?? 0) > 0,
    "a refusal says when to come back",
  );

  const state = await readAllowance(db, env, "user_bob");
  assert(state.analyses.used === limits.analyses, "used never exceeds the limit");
  assert(state.analyses.remaining === 0, "remaining bottoms out at zero");

  await consumeAllowance(db, env, "user_bob", "images");
  const secondImage = await rejects(() => consumeAllowance(db, env, "user_bob", "images"));
  assert(secondImage.code === "allowance_exhausted", "the 2nd image of the day is refused");

  // Ten at once against a limit of five. The ceiling is enforced by a single
  // conditional statement, so exactly five may win however they interleave.
  const burst = await Promise.allSettled(
    Array.from({ length: 10 }, () => consumeAllowance(db, env, "user_alice", "analyses")),
  );
  const granted = burst.filter((result) => result.status === "fulfilled").length;
  assert(granted === 5, `a burst of 10 grants exactly 5, granted ${granted}`);

  const aliceState = await readAllowance(db, env, "user_alice");
  assert(aliceState.analyses.used === 5, "concurrent consumption cannot overshoot");
}

// ── refunds give back a unit without minting one ────────────────────────────────
{
  await refundAllowance(db, "user_alice", "analyses");
  const afterRefund = await readAllowance(db, env, "user_alice");
  assert(afterRefund.analyses.used === 4, "a refund returns exactly one unit");

  for (let extra = 0; extra < 6; extra++) {
    await refundAllowance(db, "user_alice", "analyses");
  }
  const clamped = await readAllowance(db, env, "user_alice");
  assert(clamped.analyses.used === 0, "over-refunding clamps at zero rather than minting");
}

// ── the deployment ceiling refuses, and hands the user's unit back ──────────────
{
  // The system ceiling for images is 2 and Bob already spent one. A fresh account
  // has room of its own, so the only thing that can refuse it is the shared ceiling.
  await seedUser("user_carol", "carol@example.test");
  await seedUser("user_dave", "dave@example.test");
  await consumeAllowance(db, env, "user_carol", "images");

  const ceiling = await rejects(() => consumeAllowance(db, env, "user_dave", "images"));
  assert(
    ceiling.code === "system_allowance_exhausted",
    "the shared ceiling refuses once spent, distinctly from the per-user one",
  );

  const dave = await readAllowance(db, env, "user_dave");
  assert(
    dave.images.used === 0,
    "a request refused by the shared ceiling does not burn the user's own unit",
  );
  assert(dave.systemCeilingReached, "the reported state admits the ceiling is reached");
}

// ── a per-account override replaces the default, one column at a time ───────────
{
  await seedUser("user_erin", "erin@example.test");

  const before = await limitsFor(db, env, "user_erin");
  assert(before.analyses === 5 && before.analysesSource === "default", "no row ⇒ the default applies");

  // Raise analyses, leave images alone. `null` must keep tracking the default rather
  // than freezing at whatever it happens to be today.
  await db.insert(userAllowance).values({
    userId: "user_erin",
    analysesLimit: 8,
    note: "trusted user",
  });

  const raised = await limitsFor(db, env, "user_erin");
  assert(raised.analyses === 8 && raised.analysesSource === "override", "an override raises the ceiling");
  assert(raised.images === 1 && raised.imagesSource === "default", "an untouched column still follows the default");

  for (let taken = 0; taken < 8; taken++) {
    await consumeAllowance(db, env, "user_erin", "analyses");
  }
  const past = await rejects(() => consumeAllowance(db, env, "user_erin", "analyses"));
  assert(past.code === "allowance_exhausted", "the raised ceiling is the one enforced, and it still holds");

  const reported = await readAllowance(db, env, "user_erin");
  assert(reported.analyses.limit === 8, "the reported limit is the effective one");
  assert(reported.analyses.source === "override", "and it says where it came from");
  assert(reported.images.source === "default", "per column, not per account");
}

// ── zero means zero, and a negative cannot mint allowance ───────────────────────
{
  await seedUser("user_frank", "frank@example.test");
  await db.insert(userAllowance).values({
    userId: "user_frank",
    analysesLimit: 0,
    imagesLimit: -5,
    note: "no free allowance",
  });

  const blocked = await rejects(() => consumeAllowance(db, env, "user_frank", "analyses"));
  assert(blocked.code === "allowance_exhausted", "a zero override takes the free allowance away");

  const clamped = await limitsFor(db, env, "user_frank");
  assert(clamped.images === 0, "a negative override clamps to zero rather than going below it");
  const alsoBlocked = await rejects(() => consumeAllowance(db, env, "user_frank", "images"));
  assert(alsoBlocked.code === "allowance_exhausted", "and blocks, rather than being treated as unlimited");
}

// ── the admin surface is closed by default and closed to non-admins ─────────────
{
  // No allowlist configured at all: the default state of a deployment is no admins.
  const closed = await call("/v1/admin/users", ALICE_KEY);
  assert(closed.status === 403, "with no allowlist, nobody is an administrator");

  const adminEnv: Env = { ...env, ADMIN_EMAILS: "alice@example.test" };

  const outsider = await send("GET", "/v1/admin/users", { token: BOB_KEY, env: adminEnv });
  assert(outsider.status === 403, "an authenticated non-admin is refused");

  const anonymous = await send("GET", "/v1/admin/users", { env: adminEnv });
  assert(anonymous.status === 401, "admin routes still require a key first");

  const listed = await send("GET", "/v1/admin/users", { token: ALICE_KEY, env: adminEnv });
  const body = (await listed.json()) as {
    accounts: Array<{
      userId: string;
      email: string;
      analyses: { limit: number; source: string };
    }>;
  };
  assert(listed.status === 200, "an admin can list accounts");
  assert(
    body.accounts.some((account) => account.email === "bob@example.test"),
    "the list covers other accounts, which is the point of it",
  );

  // Raise Bob's analyses, leave his images on the default, and clear today's usage.
  const saved = await send("PUT", "/v1/admin/users/user_bob/allowance", {
    token: ALICE_KEY,
    env: adminEnv,
    body: { analysesLimit: 42, imagesLimit: null, note: "trusted", resetToday: true },
  });
  const account = (await saved.json()) as {
    account: {
      analyses: { limit: number; used: number; source: string };
      images: { source: string };
      note: string | null;
    };
  };
  assert(saved.status === 200, "an admin can set a limit");
  assert(account.account.analyses.limit === 42, "the new ceiling is returned");
  assert(account.account.analyses.source === "override", "and marked as an override");
  assert(account.account.images.source === "default", "the untouched column stays default");
  assert(account.account.analyses.used === 0, "resetToday clears the counters");
  assert(account.account.note === "trusted", "the note is kept");

  // Bob had already spent his 5 analyses earlier in this file; the raise plus the
  // reset must actually let him through again.
  await consumeAllowance(db, adminEnv, "user_bob", "analyses");

  const rejected = await send("PUT", "/v1/admin/users/user_bob/allowance", {
    token: ALICE_KEY,
    env: adminEnv,
    body: { analysesLimit: -1, imagesLimit: null, resetToday: false },
  });
  assert(rejected.status === 400, "a negative limit is refused rather than clamped silently");

  const unknown = await send("PUT", "/v1/admin/users/user_nobody/allowance", {
    token: ALICE_KEY,
    env: adminEnv,
    body: { analysesLimit: 1, imagesLimit: null, resetToday: false },
  });
  assert(unknown.status === 404, "an unknown account is a 404");

  const forbiddenWrite = await send("PUT", "/v1/admin/users/user_alice/allowance", {
    token: BOB_KEY,
    env: adminEnv,
    body: { analysesLimit: 9999, imagesLimit: null, resetToday: false },
  });
  assert(forbiddenWrite.status === 403, "a non-admin cannot raise their own limit");

  const cleared = await send("DELETE", "/v1/admin/users/user_bob/allowance", {
    token: ALICE_KEY,
    env: adminEnv,
  });
  assert(cleared.status === 204, "an admin can remove an override");
  const back = await limitsFor(db, adminEnv, "user_bob");
  assert(
    back.analyses === 5 && back.analysesSource === "default",
    "removing the override returns the account to the deployment default",
  );
}

store.close();
console.log("API checks passed");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Run something that must throw an ApiError, and hand back that error. */
async function rejects(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused, but it succeeded");
}
