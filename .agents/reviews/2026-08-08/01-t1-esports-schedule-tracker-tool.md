---
status: done
assignees: []
created_at: 2026-08-08 00:00:00Z
priority: medium
tags: ["tool", "popup", "network", "esports"]
---

# Review: T1 esports schedule tracker tool

Add a second tool to the registry: **T1 Esports Tracker**. Opening it from the
dashboard shows T1's upcoming League of Legends matches and their recent
results, pulled live from Riot's lolesports API.

This is the first tool that is **not** a content script and the first that
makes a **network request**, so it stretches the registry in two directions
that the Pinterest tool never did. Most of the decisions below are about how
far to stretch it.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a
`> note` under any you don't. Implementation starts only after every box is
`[x]`. Items marked **pick ONE** are mutually exclusive — check exactly one.

## Context

Already settled with the user before this checklist:

- Scope is a **panel in the popup** — no service worker, no badge, no
  notifications, no new permissions beyond host access to the API.
- The panel shows **upcoming matches + recent results**. No standings.
- The team is **hard-coded to T1**, not a user-selectable setting.

Verified against the live API while writing this (2026-08-08):

- `GET esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=…`
  returns `200` with `access-control-allow-origin: *` and allows the `X-Api-Key`
  header, so the popup can call it directly.
- Comma-separated `leagueId` works — LCK + KeSPA Cup in one request returned all
  16 T1 events in the window, correctly flagged `completed` / `unstarted`.
- Real data came back: T1 lost to HLE 1–2 today, and T1 vs DK (14/08), T1 vs GEN
  (16/08), KeSPA Knockouts (17/08), KT vs T1 (21/08), HLE vs T1 (23/08) are
  scheduled.

## Decisions

### Data source

- [x] **D1.** Use Riot's `esports-api.lolesports.com` with the public web
      `x-api-key` (`0TvQnue…`) as the only data source. It is undocumented and
      unversioned — accept that Riot can rotate the key or drop the endpoint and
      break this tool, and keep the key in one constant so the fix is one line.
- [x] **D2.** Query one request with the six leagues T1 can appear in — LCK,
      KeSPA Cup, Worlds, MSI, First Stand, Esports World Cup — then filter
      client-side for the `T1` team code, rather than one request per league.
- [x] **D3.** Handle the API's 80-event window: it is centred on "now" and shared
      across all requested leagues. If the first page yields fewer than 3
      upcoming T1 matches and a `pages.newer` token exists, fetch one more page.
      Hard cap at 2 requests per refresh.

### Caching and refresh

- [x] **D4.** Cache the normalised match list in `chrome.storage.local` (not
      `sync` — `sync` has an 8 KB per-item quota this would blow past). Existing
      `storage` permission already covers it.
- [x] **D5.** Render the cache immediately on open, then revalidate in the
      background and re-render — so the panel never opens on a spinner. Treat
      cache older than 10 minutes as stale and refresh; younger, leave it.
- [x] **D6.** On fetch failure keep showing the cached list with a "couldn't
      refresh" note and the last-updated time. Only show a hard error state when
      there is no cache at all.

### How it fits the registry

- [x] **D7.** Add an optional `hasPanel?: boolean` to `ToolDefinition`, and keep
      the panel renderer out of the registry itself. `src/popup/panels.ts` maps
      tool id → renderer, so content-script bundles never pull popup DOM code in
      through `registry.ts`.
- [x] **D8.** Colocate the tool as `src/tools/t1-tracker/{definition,constants,api,panel}.ts`
      so it stays self-contained, matching the "Adding a tool" story in README.
- [x] ~~**D9.** Add an optional `enableLabel?: string` to `ToolDefinition`.~~
      **Removed on 2026-08-09:** the labelled on/off row it named is gone — the
      switch moved into the detail view's header, opposite the way back — so
      the field had nothing left to label. `scope` survives as registry
      documentation but is no longer drawn either.
- [x] **D10.** Ship it `defaultEnabled: false`, and make the switch gate the
      network call: off means the extension contacts no external server. The
      panel then reads "switch on to load the schedule".

### Panel contents

- [x] **D11.** Show upcoming matches first (next 5), then recent results (last
      5), each as a row: opponent, tournament + block ("LCK · Week 12"), Bo-N,
      and local kickoff time.
- [x] **D12.** Show times in the user's own timezone via `Intl.DateTimeFormat`,
      with a relative hint ("in 6 days", "today 15:00").
- [x] **D13.** Mark a match with `state: "inProgress"` as **LIVE** at the top of
      the list. Derive it from the same schedule response — no second `getLive`
      call.
- [x] **D14.** Show opponent team logos from `static.lolesports.com`, rewriting
      the API's `http://` URLs to `https://` (the popup is a secure context and
      would block them otherwise) and falling back to the team code on error.
- [x] **D15.** Keep the panel's UI copy in **English**, consistent with the rest
      of the extension, even though we're talking in Vietnamese.

### Housekeeping

- [x] **D16.** Add `https://esports-api.lolesports.com/*` and
      `https://static.lolesports.com/*` to `host_permissions` in the manifest.
- [x] **D17.** Update README: tool table, permissions table, and the store
      description — which currently promises "No accounts, no tracking, no
      analytics" and needs to stay honest now that a tool talks to Riot.
- [x] **D18.** Extend `scripts/preview-popup.ts` to cover the panel with a
      stubbed `fetch` and a `chrome.storage.local` shim, so the list, the empty
      state, and the error state are all verified headlessly.

## Out of scope

- Match reminders, notifications, alarms, badge counts — explicitly deferred.
- Standings, brackets, player rosters, VOD or stream links.
- Any team other than T1; any game other than League of Legends.
- Other data sources (Leaguepedia Cargo, PandaScore) as a fallback layer.
- A background service worker. The extension still has none after this.

## Files touched

| File                                    | Change                                            |
| --------------------------------------- | ------------------------------------------------- |
| `src/common/types.ts`                   | `hasPanel?`, `enableLabel?` on `ToolDefinition`   |
| `src/common/registry.ts`                | register `t1Tracker`                              |
| `src/tools/t1-tracker/constants.ts`     | new — id, API base, key, league ids, cache key    |
| `src/tools/t1-tracker/definition.ts`    | new — registry entry, icon, `defaultEnabled: false` |
| `src/tools/t1-tracker/api.ts`           | new — fetch, page, normalise, cache               |
| `src/tools/t1-tracker/panel.ts`         | new — the panel renderer                          |
| `src/popup/panels.ts`                   | new — tool id → renderer map                      |
| `src/popup/index.ts`                    | render a panel in the detail view                 |
| `src/popup/style.css`                   | panel, match rows, live badge, states             |
| `extension/manifest.json`               | two `host_permissions` entries                    |
| `scripts/preview-popup.ts`              | stub `fetch` + `storage.local`, check the panel   |
| `README.md`                             | tool table, permissions, store description        |

`package.json` needs no new build step — the panel reaches the bundle through
`src/popup/index.ts`, and this tool ships no content script.

## Implementation notes

Two things came out differently than written above.

**D8, narrowed.** `constants.ts` was going to hold the endpoint, key, league ids
and cache key. The first build showed why it shouldn't: `definition.ts` imports
it, the registry imports `definition.ts`, and content scripts import the
registry — so `CACHE_TTL_MS` landed in `pinterest-theme.js`. (The key and league
ids were tree-shaken, but only by luck of being plain literals.) `constants.ts`
now holds the tool id alone and `api.ts` owns its own config, which is what D7
was actually after. Verified: the content bundle contains no `getSchedule`, no
key, no cache code — only the definition data `resolveStates()` needs.

**D11, split across two lines.** Competition and kickoff on one line wrapped to
two anyway at 340px. They are now `.t1-meta` and `.t1-when`, which reads
cleaner and costs nothing.

Verified with `bun run typecheck`, `bun run build`, and `bun run preview:popup`
(28 checks, all passing), plus one throwaway run against the live API: 10 rows,
correct scores, kickoffs converted to local time, and 10/10 logos loading over
the https rewrite.
