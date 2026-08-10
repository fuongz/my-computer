---
status: done
assignees: []
created_at: 2026-08-08 00:00:00Z
priority: medium
tags: ["tool", "popup", "network", "esports"]
---

# Review: Tournament group stage and bracket view

Give each tournament T1 is playing in a button that opens its group stage —
the round-robin table for a league like LCK, the bracket for a knockout group
like the Esports World Cup's.

Builds on `01-t1-esports-schedule-tracker-tool.md`, which is shipped.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a
`> note` under any you don't. Implementation starts only after every box is
`[x]`. Items marked **pick ONE** are mutually exclusive — check exactly one.

## Context

Already settled with the user before this checklist:

- The popup **widens to ~780px** for this view and returns to 340px on the way
  back, rather than cramming a bracket into 340px or opening a new tab.
- Buttons appear only for **tournaments T1 actually appears in** — today that
  is LCK Split 3 and KeSPA Cup 2026.
- A round-robin stage shows its **standings table**; a knockout stage shows its
  bracket. Same button, two renderers.

Verified against the live API while writing this (2026-08-08):

- `getStandingsV3?tournamentId=…` returns `stages[].sections[]`, and each
  section carries `type: "group" | "bracket"` — so the data says which of the
  two renderers to use rather than us guessing from the league.
- A `group` section has `rankings[]` (ordinal + teams + W-L). LCK Split 3's
  Legend Group has T1 3rd on 2-2.
- A `bracket` section has `columns[].cells[]`, each cell a **named round**
  ("Upper Bracket - Semifinals", "Finals", "Lower Bracket - Finals") holding
  its matches. EWC 2026 Group C reproduces the screenshot exactly, down to the
  five scorelines.
- LCK Split 3 has three stages: Groups (2 tables), Play-Ins (2 columns),
  Regional Championship (7 columns).

### Two API limits that shape the work

**~~No bracket linkage.~~ Corrected 2026-08-08 — the linkage is there.** The
first pass looked at `previousMatchIds`, which is empty on all 53 matches
across every stage of LCK Split 3 and EWC 2026, and concluded connectors were
underivable. That was wrong: each team inside a bracket match carries an
`origin`, and for anything past the first round it reads
`{ type: "match", structuralId: "<the earlier match>", slot: 1 | 2 }` — slot 1
being the winner's path and slot 2 the loser's. EWC Group C resolves exactly,
including both lower-bracket feeds. D5 was re-decided on that basis.

**No league id when tournaments are batched.** `getTournamentsForLeague` takes
comma-separated league ids, but each returned block contains only
`tournaments` — nothing identifying its league. Mapping a match to a tournament
therefore needs one request per league, or a guess based on response order.

## Decisions

### Finding the tournaments

- [x] **D1.** Resolve a match's tournament by asking
      `getTournamentsForLeague` **once per league** T1 has matches in (two
      today), and picking the tournament whose `startDate`/`endDate` span the
      match. Do not batch the leagues and rely on response order — the response
      carries nothing to check that guess against.
- [x] **D2.** Cache the tournament list in `chrome.storage.local` for 24 hours,
      separately from the 10-minute schedule cache. Date ranges change about
      once a split; re-fetching them on every open would triple the request
      count for nothing.
- [x] **D3.** Fetch a tournament's standings only when its button is pressed,
      not up front, and cache each one for 10 minutes under its tournament id.

### Drawing it

- [x] **D4.** Render from `section.type`: `group` → a standings table (rank,
      team, W-L), `bracket` → the named rounds laid out in columns. Never infer
      the shape from the league.
- [x] **D5. pick ONE** — connector lines between bracket rounds:
  - [ ] ~~**D5a.** **No connectors.**~~ Chosen while the linkage was believed
        underivable; superseded once `team.origin` turned up.
  - [x] **D5b.** **Real connectors**, drawn from `team.origin.structuralId` as
        an SVG overlay — exact, not inferred. Redraw on resize, and fall back
        to plain columns for any match whose origin is `seeding` or missing.
- [x] **D6.** Stack every stage of a tournament in one scrolling view with a
      heading each, rather than adding a stage switcher. LCK's three stages are
      the worst case and still read fine stacked.
- [x] **D7.** Mark T1's own row or match in every table and bracket, so its run
      is findable without reading each box.
- [x] **D8.** Widen the popup by having the panel put a marker class on its own
      element and letting the shell's stylesheet respond
      (`body:has(.t1-wide) { width: 780px }`), rather than a tool reaching into
      `document.body` directly.

### Fitting the existing tool

- [x] **D9.** Keep this inside the T1 tracker's panel as a sub-view with its own
      back link, rather than adding a third top-level view to the popup shell.
      The panel contract stays `(host, enabled)`.
- [x] **D10.** Put the tournament buttons in their own "Tournaments" section
      under the schedule, listing the tournament name and its date range.
- [x] **D11.** Reuse the schedule's states: cache-first paint, a stale-refresh
      warning, and a hard error only when nothing is cached.
- [x] **D12.** Extend `scripts/preview-popup.ts` to cover both renderers — a
      group table and a bracket — the widening, and the way back.

## Out of scope

- Rosters, player stats, VODs, streams, per-game detail within a match.
- Tournaments T1 is not in, and leagues outside the six already tracked.
- Live-updating the bracket while a match is in progress.
- Standings for a stage that has not started (the API returns it empty; the
  view will simply show nothing for that stage).

## Files touched

| File                                     | Change                                             |
| ---------------------------------------- | -------------------------------------------------- |
| `src/tools/t1-tracker/api.ts`            | tournament lookup + standings fetch, both cached   |
| `src/tools/t1-tracker/panel.ts`          | tournament list, sub-view routing                  |
| `src/tools/t1-tracker/tournament.ts`     | new — the table and bracket renderers              |
| `src/popup/style.css`                    | widening, tables, bracket columns                  |
| `scripts/preview-popup.ts`               | fixtures and checks for both renderers             |
| `README.md`                              | what the tool does now                             |

No manifest change: both endpoints are on `esports-api.lolesports.com`, which
is already in `host_permissions`.

## Implementation notes

**D5 was re-decided mid-build.** The checklist went out saying bracket linkage
was underivable, on the strength of `previousMatchIds` being empty everywhere.
It is derivable — `team.origin` carries it — so the user was asked again and
chose real connectors. The lines are read from `origin.structuralId`; a team
whose origin is `seeding`, or whose source match lives in a section we didn't
draw, simply gets none.

**One extra file, for the same reason as last time.** `constants.ts` still holds
only the tool id, so `api.ts` grew the tournament and standings lookups and the
new cache layer. Every cache entry is now stamped `{ at, value }`, which lets
reference data sit on a 24-hour clock while the schedule and standings stay on
ten minutes. Entries written before that wrapper read as nothing and are
refetched, so the old shape heals rather than needing a migration.

**The card redesign rode along.** The user supplied two lolesports.com
screenshots as the exact shape, so it needed no checklist of its own —
`.agents/todo.md` covers it. `T1Match` now carries both sides instead of "T1
and the opponent", which is what lets a card draw `T1 [logo] 1 / 2 [logo] HLE`
in the API's own order.

**Dropped the logo text fallback.** Every badge sits beside the code or name it
stands for, so falling back to text rendered "BLG BLG" whenever an image failed.
A failed logo now just leaves its box empty.

**One assertion was wrong, not flaky.** "every card carries its league badge"
counted `<img>` elements, which a failed load removes on purpose — the fixture's
logo URLs don't resolve offline, so it only ever passed by beating the `error`
event. It now counts the badge slots; whether real logos arrive is what the live
spot-check is for.

Verified with `bun run typecheck`, `bun run build`, and `bun run preview:popup`
(43 checks, all passing, stable over repeated runs), plus a throwaway run
against the live API: the LCK
tournament opens at 780px with three stages, two standings tables with T1's row
marked, two brackets, and 14 connectors drawn from real origins. Confirmed the
Pinterest content bundle still carries none of it.
