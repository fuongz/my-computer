---
status: done
schema: 1
task_id: FE-03
category: frontend
assignees: ["fuongz"]
created_at: 2026-08-23 00:00:00Z
priority: medium
tags: ["tool", "esports", "popup"]
---

# Review: Read a bracket before it is filled in — slot labels from origin

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Context

A T1 tournament's play-ins and playoffs are drawn up before anyone qualifies —
the shape of the bracket is known, and only the names are missing. The user
wants that readable in the tournament view, the way Liquipedia shows it: which
slot takes a group seed, which takes a winner, which takes a loser.

**Where the tool is today.** It already draws those stages. Asking
`getStandingsV3` for LCK Split 3 2026 right now returns all three — Groups (two
tables), Play-Ins (2 columns), Regional Championship (7 columns, 13 matches) —
and every single slot renders as a grey `TBD` badge and the word "TBD". Only
the edges between two matches get a connector line. So the shape is on screen
and none of the meaning is: nothing says a slot is an entry point rather than a
progression, and nothing distinguishes the winner's path from the loser's drop.

**The meaning is already in the response we fetch and throw away.** Every team
inside a bracket match carries an `origin`, which `api.ts` reads for
`structuralId` alone and discards the rest of. Checked live today against all
14 tournaments in the six tracked leagues (LCK, KeSPA Cup, Worlds, MSI, First
Stand, EWC — 429 slots):

- Three `origin.type` values, no nulls and no others: `match` (204),
  `decisionPoint` (246), `seeding` (48).
- **`match` + slot: slot 1 is the winner, slot 2 is the loser.** 176 of 176
  resolved edges agree, no exceptions, no orphans; the other 28 are edges into
  matches nobody has played yet. KeSPA Cup 2026's play-ins are the clean case —
  14 edges, every `slot2` a team that had just lost.
- **`seeding` + slot is the bracket's own seed number.** KeSPA Cup 2026's
  Knockouts: seed 1 enters at the Finals, seed 2 at the Semifinals, seeds 3 and
  4 at the Quarterfinals.
- **`decisionPoint` is a slot filled by a later decision, and its slot number
  is a bracket position, not a seed.** In LCK Split 3 2025's playoffs, slots 5
  and 6 of that decision point are HLE and GEN — the two *top* seeds, entering
  at Upper Bracket Round 2. Labelling those "Seed 5" and "Seed 6" would be
  wrong, which is what rules out the obvious shortcut.
- **Which column a decision point first feeds separates its two meanings, and
  does it cleanly.** Of the 19 decision points in tournaments far enough along
  to check: all 13 that first appear in the leftmost column are teams arriving
  from an earlier stage, and all 6 that first appear later are teams already in
  this bracket, placed by LCK's "Selection" step (Split 3 2025: the two Upper
  Bracket Round 2 losers choose which lower-bracket round they drop into) or by
  a Swiss re-draw (Worlds 2025, one decision point per round). No mixed case.

**Also found:** a third section type, `crossGroup` (LCK Cup 2025 and KeSPA Cup
2026 group stages). `api.ts` names only `group` and `bracket`; `crossGroup`
survives today by falling through to the "whichever half has data" branch and
landing on the table renderer, which is the right renderer by luck rather than
by intent.

No new endpoint, no new server, no new permission — this is all in a response
the tool already pays for.

**What is not derivable, and stays out.** Liquipedia puts KT, GEN and DK into
the screenshot's empty slots because it knows LCK's qualification arithmetic
and can tell when a placement is locked. Our source says `TBD` until it says a
team, and reproducing that would mean hardcoding a format that changes most
splits.

## Decisions

- [x] **D1.** **Read the origin, infer nothing in `api.ts`.** `BracketTeam` carries `origin: { kind: "match" | "seeding" | "decisionPoint"; structuralId; slot }` in place of today's `fromMatch` string, plus a `tbd` flag taken from the API's own placeholder marker (`team.id === "0"`) rather than from `code === "TBD"`. Every label below is derived in `tournament.ts`, where the section's column layout — which is what gives a decision point its meaning — is in hand.
- Pick ONE:
  - [x] **D2a.** **pick ONE — what an undecided slot reads.** Winner/Loser plus the round, abbreviated: `Winner R1`, `Loser UB R2`, `Seed 3`. The full sentence goes in the row's `title` ("Winner of Upper Bracket - Round 2"). Abbreviating is what makes it fit a 152px box, and it means a bracket reads without tracing lines that run off the side of a 780px popup. *(recommended)*
  - [ ] **D2b.** Winner/Loser alone — `Winner`, `Loser`, `Seed 3` — and let the connector lines say which match. Fits with room to spare; costs you the answer when the line is off-screen.
  - [ ] **D2c.** Full round names — `Winner of Round 1` — which needs either a wider box in every column or two lines per row.
- Pick ONE:
  - [x] **D3a.** **pick ONE — wording for the two kinds of decision point.** `Qualifier` when its slots start in the leftmost column (a team arriving from an earlier stage) and `Selection` when they start later (a team already in this bracket, placed by a seed's choice or a Swiss re-draw). Split by the rule verified above, 19 cases, no exceptions. *(recommended)*
  - [ ] **D3b.** Same split, blunter words: `Seeded` and `Draw`.
  - [ ] **D3c.** Don't split it — every decision-point slot stays `TBD`, and only match edges and `seeding` slots get a label. Half the feature, and Worlds' Swiss (which is nothing but decision points) gains nothing.
- [x] **D4.** **Drop the grey TBD logo from an undecided row** and give the label that width. A decided row keeps its team badge. Ten identical placeholder logos in a column is noise standing where the information goes. *(recommended)*
- Pick ONE:
  - [x] **D5a.** **pick ONE — the loser's path.** Draw a loser edge (slot 2) dashed and a winner edge solid, keeping T1's own accent on top of either. A lower bracket is fed entirely by loser edges, and drawn identically to the winner's path it reads as if the same team advanced twice. *(recommended)*
  - [ ] **D5b.** Leave every edge as it is drawn today — one weight, one colour.
- [x] **D6.** **A count under each bracket section's heading** — "6 teams enter this bracket" — from the distinct entry slots (a `seeding` slot, or a leftmost-column decision point's). This is the part that answers the question as asked: 4 teams into the Play-Ins, 6 straight into the Regional Championship, out of the 10 in the group stage. *(recommended)*
- [x] **D7.** **Name `crossGroup` explicitly** next to `group` in `normaliseSections`, so the KeSPA Cup and LCK Cup group stages reach the table renderer by decision instead of by fallback. *(recommended)*
- [x] **D8.** **Bump the standings cache key to `fz.t1.standings.v2`.** `BracketTeam` changes shape, and a bracket cached under the old one would otherwise render label-less — and connector-less — for up to ten minutes after the update. *(recommended)*

## Verify

- [x] **V1.** `bun run gate` — build, lint, typecheck.
- [x] **V2.** Extend `scripts/preview-popup.ts` with a second bracket fixture beside the EWC one: LCK Split 3 2026's Play-Ins and Regional Championship, reproduced field for field from today's response — an all-TBD bracket, both kinds of decision point, and loser edges. Assert the labels it produces, the dashed edges, and the entry count.
- [x] **V3.** A throwaway run against the live API over the three shapes that differ: LCK Split 3 2026 (nothing decided), KeSPA Cup 2026 (finished, `seeding` slots and byes), Worlds 2026 (Swiss, one decision point per round, 46 matches).

## Out of scope

- Naming a team before the API does — the screenshot's KT, GEN and DK come from Liquipedia knowing LCK's qualification arithmetic, and we would be hardcoding a format that changes most splits.
- "Seed #1 Rise" — which group a bracket entry draws from. Same reason: the response says a slot is filled from an earlier stage, never which table or which rank.
- Best-of per bracket match. The standings response carries no `strategy`, and the schedule endpoint we already call is filtered to T1's own fixtures, so a TBD-vs-TBD match never appears in it.
- Any second source (Liquipedia, gol.gg). The extension talks to four servers and this adds none.
- Live updates while a bracket match is in progress; the 10-minute cache stands.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/t1-tracker/api.ts` | BracketOrigin kept whole, tbd flag, sectionKind() naming crossGroup, cache key v2 |
| `apps/chrome-extension/src/tools/t1-tracker/tournament.ts` | indexBracket/slotLabel/abbreviate, the entry count, loser edges |
| `apps/chrome-extension/src/popup/style.css` | .t1-line-loser — the dashed drop into the lower bracket |
| `apps/chrome-extension/scripts/preview-popup.ts` | the pre-scheduled fixture, its 8 assertions, and real seed numbers on the EWC one |
| `README.md` | the tool table, the file map, what the preview drives, and the user-facing blurb |

## Implementation notes

**A slot's meaning is a property of its section, not of the slot.** So `api.ts`
narrows the `origin` and stops — three known kinds or null — and every label is
derived in `tournament.ts` by `indexBracket()`, which reads the whole section
once for the two things one slot cannot see: the round each match sits in, and
the column each decision point first fills. That is what lets `Qualifier` and
`Selection` come out of the same API field.

**`abbreviate()` is a vocabulary, not a truncation.** Pulled the complete list
of round names the six leagues use — 24 distinct, from `Finals` to
`Loser's Bracket - Round 3` — and every one is one or two segments of eight
patterns. A name matching none of them passes through whole rather than being
cut, so a new format reads long instead of reading wrong.

**Verified.** `bun run gate` green (build, `biome lint` over 51 files,
typecheck). `bun run preview:popup`: 8 new assertions, all 100-odd passing over
two consecutive runs, including the exact label of all 20 slots in the Regional
Championship, `26 slots, 0 untitled, 0 badged`, and `14 lines, 4 dashed`.
Throwaway live run through the real `api.ts` normaliser over all 14 tournaments
— 31 brackets, 498 slots: every slot's origin readable, only the three known
kinds, every match edge naming a round in its own section on slot 1 or 2, `tbd`
agreeing with the API's placeholder everywhere, and 13 `crossGroup` tables
reaching the table renderer. Also confirmed the Pinterest and Task Namer content
bundles and the service worker still carry none of this.

**One fixture correction on the way.** The EWC bracket's `seat()` helper gave
every seeded team `slot: 1`, which the entry count would have read as one
entrant. It now takes the seed number, and the four are 1, 2, 4, 3 — what the
live response actually says for Group C.

**Open, for a later call.** Worlds' Swiss is five rounds of decision points —
50 slots that now read `Selection`. Accurate (each round is drawn after the
last) but "Selection" is LCK's word for a seed picking its opponent, and a
Swiss pairing is a draw. If it reads wrong when Worlds 2026 starts, `Draw` is a
one-line change in `slotLabel()`; the tooltip already says both.
