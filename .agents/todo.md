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

## Lottery ticket checker (Dò vé số) tool

Gate: `.agents/reviews/2026-08-16/01-lottery-ticket-checker-d-v-s-tool.md` (FE-01,
approved, `processing`). D1 local scoring, D3 Vietnamese panel, D4 celebratory result.

1. [x] Add the tool: definition + constants, registered in `src/common/registry.ts`
       and given an icon in `src/popup/tool-ui.ts` (popup-panel tool, no content
       script).
2. [x] `provinces.ts`: the 35 draw slots (21 Miền Nam + 14 Miền Trung) as
       slug/name/region/weekday, so a province's draw days are known offline.
3. [x] `api.ts`: fetch `xskt.com.vn/<slug>/ngay-D-M-YYYY`, parse `table.result`,
       reject any table whose `i.dockq[data-url]` date is not the requested one
       (the site silently serves the same day in other years), cache per draw.
4. [x] `prizes.ts`: score a 6-digit ticket locally — suffix match G8…G1, exact ĐB,
       phụ ĐB (first digit differs), khuyến khích (one of the last five differs),
       prizes summed.
5. [x] `panel.ts`: province + date + ticket form, then a celebratory win card /
       gentle miss card over the full draw table with matches highlighted.
6. [x] Add `https://xskt.com.vn/*` to `host_permissions`.
7. [x] Typecheck, build, and drive the panel in `scripts/preview-popup.ts` with a
       fixture for the win, the miss and the no-draw-that-day states.

Added on the way, at the user's request: a searchable command-palette province
picker (`picker.ts`) in place of the `<select>`, a fully ruled and centred draw
table with the đặc biệt and giải tám emphasised, and a drop-down-only popover —
opening upwards ran off the top of the browser action's window.

## `apps/webapp` — dashboard + Mobile Legends collection

Gate: `.agents/reviews/2026-08-16/02-new-webapp-dashboard-shell-mobile-legends-collection-tool.md`
(FE-02, `processing`). D1 baked dataset, D2 localStorage, D3 Vietnamese UI,
D4 art — hotlinked at first, then downloaded to `public/mlbb/` on the user's ask.

1. [x] Restore the root `tsconfig.base.json` and the biome `components/ui`
       overrides, both removed with `apps/web` in `ba544db`.
2. [x] Scaffold `apps/webapp` on the `fc7a7ac` house style — vite plugin order,
       the `#/*` alias declared in exactly two places, the pre-paint theme script,
       the `app.css` token block, the Base UI (`base-rhea`) registry — minus every
       backend piece (auth, D1, R2, drizzle, `src/server/`).
3. [x] `scripts/sync-mlbb-data.ts`: fetch `Module:Hero/data` and `Module:Skin/data`
       from the MLBB Fandom wiki, parse the Lua tables, resolve the icon/splash URLs
       on the Wikia CDN, and write `src/tools/mlbb/data/{heroes,skins}.json`.
       133 heroes, 1007 skins. Validates every role/lane/tier/availability against
       the unions in `types.ts` before writing, which is what makes the cast in
       `catalogue.ts` honest.
4. [x] The MLBB tool: zustand `persist` ownership store with JSON export/import,
       hero and skin grids, filters on role/tier/tag/availability/owned, and
       counters that agree with what the grid is showing.
5. [x] The shell: `src/tools/registry.ts` driving both the sidebar and the
       dashboard landing page, in Vietnamese.
6. [x] `bun install` and `bun run gate`. A headless-Chrome driver was written and
       run (20 assertions over both routes, the toggle, the reload, three filters,
       the derived panel and the dark theme — all passed), then **removed at the
       user's request**: they review the app themselves.

Added on the way, at the user's request:

7. [x] `scripts/download-art.ts`: every picture pulled to `public/mlbb/<id>.webp`
       at 320px (19 MB, 1007 files — a hero and its default skin share an id, so
       1140 rows dedupe to 1007 files). `data:sync` calls it, so the two never
       drift. Nothing is hotlinked any more.
8. [x] `components/missing-heroes.tsx`: the panel that reads both owned sets at
       once and names the heroes you own a skin for but have not unlocked — the
       one question neither set answers alone, and the reason D5 keeps them apart.
9. [x] `seeds/collection-from-screenshots-2026-08-16.json`: 75 heroes and 93 skins
       read off the user's `Đã Có` captures. Heroes verified against release order
       (each capture is monotonic, chains onto the last, and the gaps are exactly
       the unowned). Skins matched by cropping each tile out of the screenshot and
       putting it beside every candidate rendered from `public/mlbb/` at the same
       3:4 crop — the artwork decides, the Vietnamese name and the rarity badge
       break ties. Nine tiles left out with reasons in `seeds/README.md`.
10. [x] Filter chips redrawn as icon + label + count badge, with a glyph per role
       (shield, sword, knife, wand, bow, heart) and per lane (chart, coins, target,
       tree, compass) so a row is scannable before it is read.
11. [x] `seeds/chua-verify/`: the 9 unmatched skin tiles, each beside every skin its
       hero owns, plus the 7 heroes that could fill the 5 slots the seed is short —
       the user verifies these by hand.
12. [x] Every user-facing `·` replaced, following the S1 decision already settled in
       `.agents/reviews/2026-08-10/08-replace-web-middot-separators.md`: contextual
       words and punctuation, an icon only where it clarifies. The one that mattered
       was the hero tile's `Đấu Sĩ · Sát Thủ · 11 trang phục` — one glyph doing two
       different jobs, so it read as three roles.
13. [x] Every filter chip and both tab labels now read `đã có/tổng` (`Đấu Sĩ 25/44`,
       `Tướng (75/133)`). Counted over the whole catalogue rather than over what the
       other filters are showing, so a chip means the same thing whichever else is
       selected; and left as a bare total until the store has read localStorage,
       because `0/44` for a frame is a claim about the account.
