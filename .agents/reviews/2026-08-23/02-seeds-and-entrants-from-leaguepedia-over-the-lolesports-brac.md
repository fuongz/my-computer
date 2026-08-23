---
status: done
schema: 1
task_id: FE-04
category: frontend
assignees: ["fuongz"]
created_at: 2026-08-23 00:00:00Z
priority: medium
tags: ["tool", "esports", "network"]
---

# Review: Seeds and entrants from Leaguepedia, over the lolesports bracket

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Context

FE-03 made an unfilled bracket readable, but every entry slot reads `Qualifier`
because lolesports says `TBD` and nothing more. The wiki the user pointed at
knows more, and this card is about whether to go and get it.

**What Leaguepedia actually holds** — read live on 2026-08-23 from
`LCK/2026 Season/Season Play-In` and `LCK/2026 Season/Season Playoffs`, the two
pages behind the user's screenshot:

    {{Bracket|4Waterfall|cargo=yes|show_bestof=yes
    |R1M1_seed_1=5 Legend   |R1M1_seed_2=1 Rise
    |R1M2_seed_1=2 Rise     |R1M2_seed_2=3 Rise }}

    {{Bracket|6DESeedsLBKOTHReseed|...|reseed=selection
    |R1M1_seed_1=3  |R1M1_seed_2=5/6
    |R1M2_seed_1=4  |R1M2_seed_2=5/6
    |R2M1_seed_1=1  |R2M2_seed_1=2 }}

That is the screenshot, field for field — "Seed #1 Rise", "Seed #5/6", the byes
into Round 2. And the Participants section carries the other half, which is the
question as the user asked it:

| Stage | Team | Its seed |
| --- | --- | --- |
| Season Play-In | KT Rolster | Legend Group #5 |
| Season Play-In | HANJIN BRION / BNK FEARX / Nongshim RedForce | Rise Group #1/2, #1/3, #2/3 |
| Season Playoffs | GEN | Legend Group #1 |
| Season Playoffs | HLE, **T1** | Legend Group #2/3 |
| Season Playoffs | Dplus Kia | Legend Group #4 |

So the wiki already knows T1 is in the Season Playoffs at Legend #2 or #3, and
that four named teams are in the Play-In — while lolesports still says TBD for
all ten slots.

**How it can be fetched, and how it cannot.** Three routes tested:

- `action=cargoquery` — the structured tables everyone recommends — answers
  `ratelimited` on the *first* anonymous request, repeatedly. Leaguepedia gates
  Cargo behind an account. Dead end without credentials.
- `?action=raw` for wikitext — Cloudflare's "Just a moment..." interstitial,
  HTTP 403. Dead end from a browser.
- `api.php?action=query&prop=revisions&rvprop=content&origin=*` — works
  anonymously, sends `access-control-allow-origin: *`, takes both page titles in
  one request, and did not rate-limit over a dozen calls. This is the route.

So the price is parsing hand-edited wikitext, and the reward is per-slot seeds
plus a named entrant list for the stage.

**What it does not hold.** The seed keys are an LCK-page practice, not a wiki-wide
one. Checked every league the tool tracks: `2026 LoL KeSPA Cup` has 8 seeded
slots (`A1`, `B1`, …) but no participant seeds; `2026 Mid-Season Invitational`,
`2026 Season World Championship/Main Event` and `Esports World Cup 2026` have
bracket templates with **zero** seed keys and no seeded participants — their
brackets are drawn after a Swiss or group stage, so there is nothing to label
early. This feature is therefore LCK-shaped, which is also where the question
arises.

**Page naming is per-league and hand-maintained**: `LCK/2026 Season/Season
Playoffs`, `2026 LoL KeSPA Cup`, `2026 Season World Championship/Main Event`,
`2026 Mid-Season Invitational`, `2026 First Stand`, `Esports World Cup 2026`.
There is no id anywhere joining a lolesports tournament to a wiki page — the
only join available is league + year + the stage dates in the page's Infobox
(`sdate=2026-08-26`, `edate=2026-08-28`).

**One thing that lines up better than expected.** The wiki's seeded slots, in
reading order, land exactly on the `decisionPoint` entry slots FE-03 already
identifies, in slot order: 4 against 4 for the Play-In, 6 against 6 for the
Playoffs, and the LCK's byes fall in the same places in both. So the two sources
can be zipped without either one knowing the other's ids.

## Decisions

- [x] **D1.** **Transport: `api.php?action=query&prop=revisions` and nothing else.** One request per tournament with both stage pages batched into `titles=A|B`, cached 24 hours beside the existing reference caches. Not `cargoquery` (anonymous callers get `ratelimited` immediately), not `?action=raw` (Cloudflare 403).
- Pick ONE:
  - [x] **D2a.** **pick ONE — how much of the page to read.** Both halves: the `{{Bracket}}` seed keys *and* the Participants team→seed list. They are in the same wikitext, so the second half is free once the first is fetched, and it is the half that answers "who gets into play-ins and playoffs". *(recommended)*
  - [ ] **D2b.** Only the Participants list — shown as a "who's in" line under the stage heading, with no change to the bracket's slots.
  - [ ] **D2c.** Only the per-slot seed labels — the bracket reads right, but the fact that T1 is already in the playoffs stays invisible.
- Pick ONE:
  - [x] **D3a.** **pick ONE — how a wiki label finds its box.** Zip the wiki's seeded slots (reading order, `R1M1_seed_1` → `R1M2_seed_2` → `R2M1_seed_1`) against the section's `decisionPoint` entry slots (slot order). If the two counts differ, use none of them and keep FE-03's labels. Verified 4↔4 and 6↔6 against LCK 2026. *(recommended)*
  - [ ] **D3b.** Parse the round and match indices out of the `RxMy` keys and place by those. More literal, and wrong the moment the two sources group rounds differently — lolesports puts Upper Bracket Round 2 and Lower Bracket Round 1 in one column, the wiki does not.
- [x] **D4.** **A six-entry page-title table**, parameterised on the year, plus the LCK season hub (`LCK/<year> Season` links its own stage pages) for LCK's sub-stages — then pick the page whose Infobox `sdate`/`edate` overlap the lolesports tournament. A league with no rule, no page, or no overlap keeps today's labels and costs one cached miss. *(recommended)*
- Pick ONE:
  - [x] **D5a.** **pick ONE — whether to ask first.** A tool setting, **off by default**: "Read Leaguepedia for seeding". The tool's own switch already gates lolesports; a fifth server is the user's call the same way the OpenRouter key is, and a wiki read is not what someone switching on a schedule tracker asked for. *(recommended)*
  - [ ] **D5b.** Always on once the tool is on — one less switch, one more server nobody opted into.
- [x] **D6.** **Credit it.** A bracket that used the wiki gets a line saying so — "Seeds from Leaguepedia", linking the page it read — because Fandom content is CC BY-SA and because a label from a second source should say it came from one. *(recommended)*
- [x] **D7.** **The wiki may only upgrade a label, never replace the bracket.** Every failure — 403, rate limit, missing page, unknown template, a count that doesn't line up, a seed string we can't read — is silent, and the slot falls back to `Qualifier`. The bracket's structure stays lolesports' alone, so a wiki edit can never break the view that works today. *(recommended)*
- [x] **D8.** **Add `https://lol.fandom.com/*` to `host_permissions`**, and change the README's "talks to four servers and no more" to five, naming what the fifth is for. Team logos still come from lolesports; no images are read from Fandom. *(recommended)*

## Verify

- [x] **V1.** `bun run gate`.
- [x] **V2.** `scripts/preview-popup.ts`: extend the pre-scheduled fixture's stub with today's real wikitext for both LCK pages, and assert the upgraded labels (`Rise #1`, `Legend #5`, `Seed 5/6`), the entrant list, the credit line, and — separately — that a 403 and a slot-count mismatch both leave FE-03's labels untouched.
- [x] **V3.** A throwaway live run over all six leagues, printing exactly what each yields, so the README's claim about which leagues benefit is measured rather than assumed.
- [x] **V4.** Confirm the setting actually gates the request: with it off, zero calls to lol.fandom.com (the preview driver already asserts this shape for lolesports and xskt).

## Out of scope

- Cargo (`action=cargoquery`) and anything that needs a Leaguepedia account or bot password.
- Per-match best-of from the wiki. `{{AutoMatches}}` and `show_bestof` both resolve through Cargo; the format prose says "all matches are best of five" but prose is not a field.
- Worlds, MSI, First Stand and EWC brackets. Their pages carry no seed keys and no seeded participants — the code reads them and finds nothing, which is the correct outcome, not a bug to fix.
- Rosters, players, VODs, picks and bans, and every other thing on those pages.
- Liquipedia. Its API wants a custom User-Agent a browser cannot set, and its terms are stricter.
- Writing to the wiki, or caching its text beyond the 24-hour reference cache.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/t1-tracker/wiki.ts` | new — the page table, the hub walk, the revisions fetch, the wikitext parse, the 24-hour cache |
| `apps/chrome-extension/src/tools/t1-tracker/api.ts` | readFreshEntry/writeEntry and REFERENCE_TTL_MS exported, so wiki.ts caches on the same clock |
| `apps/chrome-extension/src/tools/t1-tracker/tournament.ts` | pairBrackets, seedLabel, the entrant chips, the credit link |
| `apps/chrome-extension/src/tools/t1-tracker/constants.ts` | the setting key, next to the tool id and for the same reason |
| `apps/chrome-extension/src/tools/t1-tracker/definition.ts` | the off-by-default setting |
| `apps/chrome-extension/src/tools/t1-tracker/panel.ts` | seedingFor(), and asking for standings and seeds together |
| `apps/chrome-extension/src/popup/index.ts` | a setting change redraws the tool's panel |
| `apps/chrome-extension/extension/manifest.json` | host_permissions for lol.fandom.com |
| `apps/chrome-extension/scripts/preview-popup.ts` | the wiki stub, 8 assertions, the outage path, and the fixtures swapped onto the LCK row |
| `README.md` | five servers, the permission table, the file map, the preview, and the blurb |

## Implementation notes

**Everything the wiki says is optional, and the code is shaped by that.**
`wiki.ts` returns `null` for a moved page, an unknown template, a title table
with no rule, dates that don't overlap, or a seed string it can't read;
`pairBrackets()` returns nothing for a count it can't match one-to-one; and
`slotLabel()` falls back to FE-03's `Qualifier` whenever a seed is absent. The
outage path is asserted, not assumed: with the stub answering 503 the bracket
still reads `Qualifier | Qualifier | … | Loser R1 | Winner R1` and nothing is
credited.

**Two things the live run taught, which no fixture would have.** A seed's value
is usually `[[LCK/2026 Season/Rounds 3-4|Legend Group #5]]`, and the pipe inside
that wikilink is not the end of the parameter — the first parse returned
`[[LCK/2026 Season/Rounds 3-4` for all eight entrants. The head is now unlinked
*before* the pipe-stopping regexes run. And a roster with no players listed
would read the seed off the roster below it, so each roster's parameters are
bounded by where the next one starts.

**A transport failure is not cached; an empty answer is.** A league the wiki
doesn't cover would otherwise be asked about on every open, and a minute of bad
network would otherwise switch the feature off for a whole day. The fetch also
carries `AbortSignal.timeout(4000)`, because the bracket waits for this call and
a server that accepts a connection and then says nothing must not be able to
hold up a view Riot's answer alone can draw.

**One change outside the tool.** A setting used to be able to change what a
panel would draw without the panel being told — the panel is rendered above the
settings and only redrawn by the on/off switch. `renderSetting` now takes an
`afterChange` callback, so switching the seeding on redraws the tracker. Any
tool with both a panel and settings gets that.

**One existing assertion was narrowed, not deleted.** "shows no appearance of
its own" counted every `.segment` in the detail view, which was only true while
the first openable tool had no settings of its own. It now counts the appearance
control's own segments (`system`/`dark`/`light`), which is what its name claims.

**Verified.** `bun run gate` green. `bun run preview:popup`: 111 checks, all
passing over three consecutive runs, including the exact label of all 20 slots
in the Regional Championship and all 6 in the Play-Ins, both entrant lines by
team code, T1's own chip, both credit links, `LCK/2026 Season >> …/Cup|…/Rounds
3-4|…/Season Play-In|…/Season Playoffs` as the only two wiki requests, zero wiki
requests while the setting is off, and the 503 path. Three throwaway live runs:
`wiki.ts` against the real wiki for all six leagues (LCK yields both brackets
and eight entrants in 2 requests; Worlds yields nothing in 1; KeSPA's
two-bracket page yields its 8 play-in seeds and correctly no entrants), and one
that puts the real `api.ts` and the real `wiki.ts` side by side on LCK Split 3
2026 — 4 entry slots against 4 seeds, 6 against 6, which is the pairing the
fixtures assert.

**Where it stands, on the day.** The Season Play-In starts 2026-08-26 and the
Season Playoffs 2026-08-29, so this is live data for the next three weeks: T1
appears as an entrant of the playoffs at Legend Group #2/3, and the ten empty
slots read as seeds rather than as `Qualifier`.
