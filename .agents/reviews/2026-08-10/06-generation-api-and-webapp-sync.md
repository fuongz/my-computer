---
status: processing
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z
priority: high
tags: ["api", "webapp", "chrome-extension", "api-key", "cost", "security"]
---

# Review: one public generation API, and extension ↔ webapp sync

Create `apps/api`: a public HTTP API that owns every OpenRouter and Replicate
call. The extension stops talking to providers and talks to **one** URL,
authenticating with the `fz_` API key it already can be issued from
`/settings/api-keys`. Generations are retained in the webapp, and every request
is priced — either against a small free daily allowance on system keys, or as a
cost audit log for users running their own keys.

**How to review:** flip every applicable `- [ ]` to `- [x]`; write `> notes`
under any item you disagree with. For each **pick ONE** group, check exactly one
option. Implementation begins only once every gating box is checked.

**Approved** 2026-08-10: M1, N1, Q1 selected; every gating box checked.

**Implemented** 2026-08-10. `bun run gate` green; four deterministic suites pass.
Deviations and decisions taken during implementation, all deliberate:

- **X1, as shared pieces rather than one factory.** `@fuongz/auth` exports
  `authBase()`, `apiKeyPlugin()`, the AES-GCM secret format and the schema; each app
  composes its own `betterAuth()` from them. A single factory taking extra plugins
  would have widened the plugin array to a union and lost the typing of
  `auth.api.verifyApiKey`, which is the one call the API exists to make.
- **V4: `apps/api/src` DID join the layout audit.** Its folders are `http/`,
  `services/` and `lib/`, which the audit's layer law either polices correctly or
  ignores; `routes/` would have failed rule 3 (a Hono module exports a router, not
  `Route`).
- **The web app reads and deletes R2 directly** rather than calling its own public
  API. It already holds the session; making it mint itself an API key would be
  ceremony. It therefore also binds the bucket, and serves its gallery bytes from
  `/api/generations/$id/image`.
- **The web pages fetch in an effect, not through a route `loader`.** Route types
  flow into the router type, `Register` publishes that, and `createServerFn` reads
  `Register` — so a loader that calls a server function closes a type cycle and
  `useLoaderData()` degrades to `never`. Casting around it would have been a lie in
  every page; the server functions themselves are correctly typed.
- **Allowance ceilings are mirrored in both `wrangler.jsonc` files.** `apps/api`
  enforces them, `apps/web` only reports them on `/usage`. They must be changed in
  both, and the reason is commented in each.
- **A6 relaxed slightly:** `POST /v1/images` accepts an optional `quality`, defaulting
  to `low` — the value the extension has always sent. The price table is keyed by
  quality, so the parameter is what makes it mean anything.
- **E3 needed no dialog changes.** Its existing error state already offers either
  *Open Settings* or *Try again*, which is exactly the pair the new not-connected,
  allowance-exhausted and poll-timeout cases need.
- **One bug the tests caught before it shipped:** the refund path decremented the
  deployment ceiling even when it was the ceiling that had refused the request —
  leaking the circuit breaker by one request for every request it turned away.
  `consumeAllowance` now unwinds only what it actually took.


## Settled — recorded from review round 1

- [x] **C3.** **Two credential modes.** *Default* uses system-owned provider keys
      and is metered by a free daily allowance; *BYOK* uses the user's own keys,
      is never metered, and only records results and a cost audit log.
- [x] **R1.** **API-only.** Every analyze/generate call goes to the API; the
      provider `fetch` code is deleted from the service worker. The sync switch
      controls **retention**, not routing.
- [x] **T3.** **Always async for images.** `POST /v1/images` writes a `processing`
      row and returns it; the client polls until a terminal state.
      > The client gives up at 60s and shows a timeout in the UI **without**
      > writing anything to the row — see the async section below.
- [x] **S1.** Copy generated output into **R2**; serve it behind auth.
- [x] **X1.** New workspace package `packages/auth` (`@fuongz/auth`) exporting the
      Better Auth factory and the Drizzle schema, imported by both apps.
- [x] **H1.** **Hono** on Workers, routes under `/v1`, Zod-validated bodies.

## Which mode a request runs in — pick ONE

- [x] **M1.** **Derived per provider, per request.** A stored credential for that
      provider ⇒ BYOK for that call; none ⇒ Default. So a user with only an
      OpenRouter key gets BYOK analyses and Default-allowance images, with no extra
      switch anywhere. *(Recommended: no redundant UI, and "Default" behaves as what
      the word means — the fallback.)*
- [ ] **M2.** **Explicit account-level choice** between Default and BYOK, so a user
      holding their own key can still deliberately spend the free allowance.
- [ ] **M3.** Per-request override via a body field.

## Exposure of the Default allowance — pick ONE

GitHub sign-in currently accepts any account, so Default mode means any stranger
can spend the deployment's provider money, 5 analyses and 1 image at a time.

- [x] **N1.** **Accept it, with a global circuit breaker.** Keep sign-up open, and
      add a deployment-wide daily ceiling across all Default traffic; once it is
      hit, Default requests are refused until the next reset while BYOK keeps
      working. *(Recommended: keeps the app public, and bounds the worst day to a
      number you choose rather than to how many accounts sign up.)*
- [ ] **N2.** **Allowlist.** Only configured accounts get a Default allowance;
      everyone else must supply their own keys.
- [ ] **N3.** No safeguard beyond the per-user daily allowance.

## Allowance reset boundary — pick ONE

- [x] **Q1.** **UTC calendar day**, with `resetsAt` reported on `/v1/usage` and in
      the refusal. *(Recommended: predictable, trivially computed, and easy to state
      in the UI.)*
- [ ] **Q2.** Rolling 24 hours from each consumed unit.
- [ ] **Q3.** A named fixed timezone, recorded below.

## The API app

- [x] **A1.** Create `apps/api` as its own Worker (`wrangler.jsonc`, own name and
      deploy), bound to the **same** D1 database as `apps/web` plus an R2 bucket for
      outputs. It serves JSON only — no UI, no cookies, no session auth.
- [x] **A2.** Authenticate every `/v1` route with `Authorization: Bearer fz_…`
      verified through the Better Auth API-key plugin, resolving the owning user.
      Reject missing, unknown, disabled, or expired keys with a uniform
      `401`/`403`, and never echo the key back in a response or a log line.
- [x] **A3.** Ship this surface, versioned under `/v1`, with one error envelope
      (`{ error: { code, message } }`) for every failure:
      | Route | Purpose |
      | --- | --- |
      | `GET /v1/health` | Unauthenticated liveness. |
      | `GET /v1/me` | Which account and key the caller is using; per-provider mode; allowance remaining. |
      | `POST /v1/analyses` | Image → one `gpt-image-2` prompt (OpenRouter). Synchronous. |
      | `POST /v1/images` | Prompt → image (Replicate). Returns a `processing` generation. |
      | `GET /v1/generations` | The caller's own history, newest first, cursor-paged. |
      | `GET /v1/generations/{id}` | One generation; reconciles a `processing` row against the provider. |
      | `GET /v1/generations/{id}/image` | The stored output bytes. |
      | `GET /v1/usage` | Allowance used/remaining and `resetsAt` (Default), plus the cost audit ledger (BYOK). |
- [x] **A4.** Every route reads and writes only rows owned by the calling user;
      an id belonging to another account is a `404`, not a `403`.
- [x] **A5.** Configure the API-key plugin's rate limit deliberately. The schema
      default is 10 requests per day, which would break normal use on day one —
      pick a real window and ceiling, and return `429` with `Retry-After`. This is
      transport-level abuse protection, separate from the Default allowance.
- [x] **A6.** Keep the model choices (`openai/gpt-5.6-luna`,
      `openai/gpt-image-2`) and the analysis prompt text identical to today's
      behavior, so this slice changes where the call happens and nothing else.

## Default mode: the free daily allowance

- [x] **D1.** System provider credentials are Worker secrets on `apps/api`
      (`SYSTEM_OPENROUTER_API_KEY`, `SYSTEM_REPLICATE_API_TOKEN`), never in the
      database and never reachable from a response.
- [x] **D2.** Per user, per period: **5 analyses** and **1 image**. Both ceilings
      come from environment configuration rather than being hard-coded, so they can
      be tuned without touching code.
- [x] **D3.** Consume the allowance with a **single conditional SQL statement**
      (`… SET analyses_used = analyses_used + 1 WHERE … AND analyses_used < :limit`)
      and treat "zero rows changed" as exhausted. Counting history rows, or
      read-then-write, lets two concurrent requests both pass the check — the exact
      failure that is invisible until someone double-clicks.
- [x] **D4.** Consume **before** the provider call. Refund the unit when the failure
      is not the user's — provider 5xx, network error, our own bug — and do not
      refund a rejected input. A refused request must never quietly burn a unit.
- [x] **D5.** Refuse an exhausted allowance with a distinct machine-readable code,
      `429`, `Retry-After`, and the reset time, **before** any provider call.
- [x] **D6.** Report allowance state on `GET /v1/me` and `GET /v1/usage` so the
      extension can say "2 of 5 analyses left today" without guessing.

## BYOK mode: credentials and the cost audit log

- [x] **K1.** Provider credentials are encrypted at rest with AES-GCM and a fresh
      IV per record; the master key is a Worker secret shared by `apps/web` (which
      encrypts on save) and `apps/api` (which decrypts to call). Only a last-4
      fingerprint is ever returned to a client.
- [x] **K2.** BYOK requests are **never blocked** on cost — no budget, no cap, no
      credit accounting. We record, we do not gate.
- [x] **K3.** Persist one audit row per provider call: user, key, mode, kind,
      provider, model, status, latency, provider request id, token counts
      (OpenRouter) or prediction metrics (Replicate), and cost.
- [x] **K4.** Store cost as **integer micro-USD**, never a float, and record whether
      the figure came from the provider or from a local price table — so a later
      price change never silently rewrites old history.
- [x] **K5.** Take OpenRouter's own reported cost from the response rather than
      estimating it. Replicate does not report cost, so price it from a small
      committed table keyed by model and quality and mark those rows as estimates.
- [x] **K6.** A failed call still writes its audit row, with the error and any cost
      incurred. Invisible failures are how spend gets surprising.

## Asynchronous image generation

- [x] **G1.** `POST /v1/images` inserts a `processing` row **before** calling
      Replicate, stores the returned prediction id on it, and responds with the
      generation id and status. There is no synchronous fast path.
- [x] **G2.** `GET /v1/generations/{id}` drives the state machine: for a
      `processing` row it asks Replicate for the prediction, and on a terminal
      answer copies the output into R2, records cost, and writes the terminal
      status. The poll *is* the reconciler — no webhook, no background timer.
- [x] **G3.** The client polls for at most **60 seconds**, then shows a timeout in
      the UI and stops. It writes nothing: the row stays `processing`, and a later
      poll or a later visit to `/generations` will finish it if the prediction
      eventually succeeded. A UI timeout is not a failed generation.
- [x] **G4.** Surface a `processing` row honestly wherever it appears — the gallery
      shows it as still running rather than as a broken image — and reconcile it on
      view rather than leaving a permanent ghost.
- [x] **G5.** `POST /v1/analyses` stays synchronous; it is one fast chat completion
      and gains nothing from a job record.

## Retention: what the sync switch actually changes

- [x] **P1.** Switch **on**: the row keeps the prompt, the source reference, and the
      output object in R2, and appears in `/generations`.
- [x] **P2.** Switch **off**: the row still exists — it is the job record the poll
      needs, and the audit/allowance record — but the prompt and source reference
      are not stored, nothing is written to R2, and the poll hands back the
      provider's own ephemeral output URL for immediate display and download.
- [x] **P3.** The switch is never retroactive: flipping it off does not delete
      already-retained generations, and flipping it on does not resurrect skipped
      ones. Deleting history stays an explicit action in the webapp.

## Web app

- [x] **W1.** `/settings/providers`: save, replace, and remove the OpenRouter and
      Replicate keys, stating plainly what having one changes — own key ⇒ unmetered
      and billed to you; no key ⇒ the free daily allowance. Show only a last-4
      fingerprint after saving; never render a stored key again, and never send one
      to the browser.
- [x] **W2.** `/generations`: the retained generations — output image, the prompt
      (copyable), source, model, mode, cost, when — with download and delete, and an
      honest `processing` state. Deleting removes the stored object as well as the
      row.
- [x] **W3.** `/usage`: today's allowance used and remaining with its reset time,
      and the cost audit ledger split by provider and mode.
- [x] **W4.** Extend `/settings/api-keys` with what a key is now *for*: the API base
      URL to paste into the extension, and the rate limit that applies.
- [x] **W5.** Every one of these routes is private by default, consistent with the
      existing `beforeLoad` session guard.

## Extension

- [x] **E1.** Options page: replace the two provider-key fields with an API base
      URL, the `fz_` key, a **Sync generations to webapp** switch, and a
      **Test connection** action that reports the signed-in account, the per-provider
      mode, and the allowance left — or the reason it failed.
- [x] **E2.** The service worker calls only the configured API base URL. Delete the
      OpenRouter and Replicate `fetch` code, and drop `openrouter.ai` and
      `api.replicate.com` from `host_permissions` in favour of the API origin.
- [x] **E3.** Keep the analysis dialog's states as they are (confirm → analyzing →
      prompt → generated image, plus copy, download, minimize, drag). Add only what
      is genuinely new: not-connected, allowance-exhausted, and poll-timeout —
      each distinguishable from a generic failure, and the timeout worded so it is
      clear the image may still turn up in the webapp.
- [x] **E4.** On upgrade, do not silently delete the provider keys already in local
      storage. Stop reading them, tell the user once where they now belong, and give
      them a control that removes them.

## Security

- [x] **S3.** No secret — system provider key, stored user credential, API key, or
      plaintext bearer token — is ever logged, returned by an endpoint, or included
      in an error message.
- [x] **S4.** The caller-supplied image URL is forwarded to OpenRouter and not
      fetched by the API. Anything the API *does* fetch itself (the generated output
      on its way to R2) is restricted to the provider's expected hosts, so a
      user-controlled string can never point the Worker at a private address.
- [x] **S5.** CORS is an explicit allowlist — the configured extension ids and the
      webapp origin — not `*`, and credentials are never allowed.
- [x] **S6.** Validate and bound every request body (prompt length, enum values,
      URL scheme) before any provider call or allowance consumption.
- [x] **S7.** Every secret name appears in the checked-in environment example with a
      name only, never a value.

## Verification

- [x] **V1.** Generate the Drizzle migration for the new tables and apply it locally
      and remotely; add `apps/api/.env.example` with names only.
- [x] **V2.** Deterministic coverage for the parts that are easy to get wrong and
      invisible when they are: key verification (accept / reject / rate-limit); user
      isolation between two accounts; **concurrent** allowance consumption never
      exceeding the ceiling; refusal happening before the provider call; the refund
      rule; cost arithmetic in micro-USD; and the poll reconciling `processing` →
      terminal exactly once.
- [x] **V3.** An end-to-end walkthrough against a locally running API with stubbed
      providers, covering both modes: analyze → generate → poll → stored → visible
      in `/generations` → counted in `/usage`; the sync switch off proving nothing is
      retained; and a stubbed slow prediction proving the 60s UI timeout leaves the
      row untouched and a later poll still completes it.
- [x] **V4.** Run `bun run gate` (build, lint + layout audit, typecheck) and record
      whether `apps/api/src` joins the layout audit's roots in `layout.audit.json`.

## Shipping order

Approving this approves all five; they land in this order, each independently
verifiable:

1. `packages/auth` + `apps/api` skeleton with `/v1/health`, `/v1/me`, and key auth.
2. Schema, encrypted BYOK credentials, the allowance table, `/settings/providers`.
3. `POST /v1/analyses` — synchronous, both modes, allowance and audit log.
4. `POST /v1/images` + poll reconciliation + R2.
5. Extension cutover, then `/generations` and `/usage`.

## Context

`apps/web` already mints `fz_` API keys through Better Auth, and the extension
already holds provider keys locally and calls OpenRouter and Replicate straight
from its service worker. That split means provider secrets sit in a browser
profile, generations vanish when a tab closes, and nothing anywhere knows what
has been spent. One API in front of the providers fixes all three at once, gives
newcomers a working free tier on system keys, and gives power users their own
keys with a cost log instead of a cap.

## Out of scope

Generating images from the webapp UI; sharing or public generation links; paid
plans, top-ups, or any billing; teams/organizations, roles, or org-scoped keys;
additional providers or models; streaming responses; an OpenAPI document and
published SDK; Replicate webhooks; idempotency keys; a custom API domain and DNS;
CI/CD for the new Worker; and any change to the Pinterest theme or T1 tracker
tools.

## Files touched

| File | Change |
| --- | --- |
| `.agents/todo.md` | Implementation steps, once this gate is approved. |
| `packages/auth/**` | Shared Better Auth factory and Drizzle schema. |
| `apps/api/**` | New Worker: router, key auth, mode resolution, allowance, provider adapters, poll reconciliation, R2 output storage, wrangler and env config. |
| `apps/web/src/server/db/**`, `apps/web/migrations/**` | Provider-credential, generation, and daily-allowance tables. |
| `apps/web/src/server/**` | Encrypt/decrypt BYOK credentials; usage, allowance, and generation queries. |
| `apps/web/src/routes/settings/providers.tsx`, `generations.tsx`, `usage.tsx`, `settings/api-keys.tsx` | Provider keys, gallery, spend and allowance, extension setup hint. |
| `apps/web/src/components/features/**` | UI for the routes above. |
| `apps/chrome-extension/src/background/index.ts` | Replace provider calls with API calls and the image poll loop. |
| `apps/chrome-extension/src/common/api-keys.ts`, `src/options/**` | API base URL, `fz_` key, sync switch, connection test, local-key cleanup. |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.ts` | Not-connected, allowance-exhausted, and timeout states. |
| `apps/chrome-extension/extension/manifest.json` | Swap provider hosts for the API origin. |
| `layout.audit.json`, root `package.json` | Add the new roots and scripts to the gate. |
| `README.md`, `apps/api/README.md` | Document the API, the two modes, and the extension's new setup. |
