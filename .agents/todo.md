# Todo

## Generated-image height

1. [x] Raise the generated result's maximum height to 100vh.

## Replace middot separators in the web app

Gate: `.agents/reviews/2026-08-10/08-replace-web-middot-separators.md` (awaiting approval).

1. [x] Inventory every visible `·` occurrence in `apps/web` and choose a readable
       icon or text alternative for each context.
2. [ ] Apply the approved replacements, including the obscured provider-key suffix.
3. [ ] Run the web app's typecheck/build and visually check the affected screens.

## Text-generation timeout

1. [x] Abort OpenRouter prompt analysis after 30 seconds.
2. [x] Return a timeout-specific dialog error that exposes the existing Retry action.
3. [x] Typecheck and build the extension.

## Source image aspect ratio for generation

1. [x] Verify the current `gpt-image-2` Replicate schema and identify its supported sizing controls.
2. [ ] Agree on how each source-image ratio maps to the model's supported aspect-ratio presets.
3. [ ] Pass source dimensions from the dialog to the background request and add coverage for the mapping.
4. [ ] Run extension typecheck, build, and dialog preview.

## One public generation API + extension ↔ webapp sync

Gate: `.agents/reviews/2026-08-10/06-generation-api-and-webapp-sync.md` (approved,
`processing`). M1 derived mode, N1 global circuit breaker, Q1 UTC day.

1. [x] `packages/auth` (`@fuongz/auth`): move the Better Auth Drizzle schema out of
       `apps/web`, add the generation/credential/allowance tables, and export the
       shared pieces both apps build their Better Auth instance from — one schema,
       one key policy, no drift. Repoint `apps/web` at it.
2. [x] `apps/api` skeleton: Hono on Workers, same D1 + an R2 bucket, `fz_` bearer
       auth middleware, one error envelope, `GET /v1/health` and `GET /v1/me`.
3. [x] Credentials + allowance services: AES-GCM encrypt/decrypt, per-provider mode
       resolution (M1), single-statement conditional consume with `RETURNING` for
       both the per-user and the deployment ceiling (D3, N1), plus `/settings/providers`
       in the webapp.
4. [x] `POST /v1/analyses` (synchronous OpenRouter) then `POST /v1/images` +
       `GET /v1/generations/{id}` poll reconciliation + R2 copy, both writing the
       cost audit row.
5. [x] Extension cutover: one API URL, sync switch, connection test, new dialog
       states; then `/generations` and `/usage` in the webapp.

Verified: `bun run gate` green; `test:api` (key auth, cross-account isolation,
concurrent allowance, refund rules, provider-unavailable), `test:flow` (analyse →
generate → poll → retained/not → usage → delete), `test:connection` and
`test:prompt-flow` all pass.

Follow-ups landed after the main slices:

6. [x] MV3 poll fix: the wait for an image moved from the service worker into the
       content script. A service worker is torn down after ~30s idle and a pending
       `setTimeout` does not count as activity, so a 31-second Replicate job left the
       dialog spinning forever. The worker is now stateless — one message, one check.
7. [x] Per-account allowance override (`user_allowance`, migration `0002`): nullable
       per column, `0` means zero, negatives clamp, the deployment ceiling still
       applies. Reported on `/v1/me`, `/v1/usage` and the web `/usage` page with its
       source. Set by SQL; see apps/api/README.md.
8. [x] Admin surface for those limits, so SQL is not the only way: `ADMIN_EMAILS`
       allowlist (config, not a role column — privilege the app cannot grant itself),
       `/v1/admin/users` + `PUT|DELETE .../allowance`, and an **Account limits** page
       in the web app with a nav entry only admins see. Covered by tests for the
       closed-by-default state, non-admin refusal, and a non-admin failing to raise
       their own limit.

9. [x] Closed the reconcile gap by extracting `packages/generation` (`@fuongz/generation`):
       the Replicate adapter, R2 storage and the reconciler, parameterised on a db, a
       bucket port and a `secretFor` callback. Both apps use the one implementation —
       the API on its poll, the web gallery on load — so a tab closed mid-generation no
       longer leaves a card that never resolves. The bucket is a structural port, not
       `R2Bucket`: wrangler's generated types and `@cloudflare/workers-types` describe
       the same binding differently, and a shared package should not pick for its
       consumers. Needs `SYSTEM_REPLICATE_API_TOKEN` on apps/web too.
10. [x] UI: shadcn sidebar replaces the nav bar (`components/shared/app-shell.tsx`),
       Usage reads as meters, API keys as a searchable table, BYOK as a provider list
       with per-row forms, Generations split into image cards and a prompt-generation
       table. Registry lint exceptions went into `biome.jsonc` rather than into the
       vendored files, which the next `shadcn add` would overwrite.

Left for the user (their call, stated in the review's V1):

- `bun run --cwd apps/web db:migrate:local` / `:remote` — `0001` creates the four
  new tables and raises the rate limit on any key minted before it; `0002` adds
  `user_allowance`.
- `unset CLOUDFLARE_ACCOUNT_ID` (it points at an account the logged-in wrangler
  token cannot access, which is why remote D1 returns 7403).
- Create the R2 bucket `fuongz-generations`, and set the secrets named in
  `apps/api/.env.example` and `apps/web/.env.example`. `BETTER_AUTH_SECRET` and
  `PROVIDER_ENCRYPTION_KEY` must be IDENTICAL in both Workers.
- Deploy `apps/api`, then paste its URL and a fresh `fz_` key into the extension's
  Options page.

## Task Name Translator — selection popup setting

1. [x] Inspect the Task Name Translator popup, overlay, and persisted settings patterns.
2. [x] Add a second settings screen with a toggle for showing the popup on text selection.
3. [x] Persist the preference and make the content overlay respect it.
4. [x] Run the relevant typecheck/build and verify the changed flow.
