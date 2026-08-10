---
status: done
assignees: []
created_at: 2026-08-09 00:00:00Z
priority: medium
tags: ["popup", "css", "design-system"]
---

# Review: a soft-elevation design system

Restyle the popup after the reference the user supplied: monochrome surfaces
layered by **shadow rather than hairline**, large radii, circular icon chips,
and a hover state that raises rather than tints.

The palette is already black-and-white and the type is already Geist, so this is
about **form**, not colour.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a
`> note` under any you don't. Items marked **pick ONE** are mutually exclusive.
Saying "chạy thôi" takes the recommended option everywhere.

## What the reference is actually doing

- Three tonal layers: page → container → row, each a step lighter (light mode)
  or lighter-on-darker (dark mode).
- **No visible borders.** Separation comes from tone plus a soft ambient shadow,
  and in dark mode from a 1px inner highlight along the top edge — that is what
  keeps a dark card from dissolving into a dark page.
- Radii around 20px on the container, ~14px on rows, full circles on icon chips.
- Hover lifts one row: lighter surface, larger shadow.
- A finished row is dimmed rather than removed, with a filled check.

## Where it fits this popup, and where it fights it

The reference is a four-item checklist with a lot of air. This popup is 340px
wide and, in the T1 tool, dense: ten match cards, standings tables, a bracket of
13 boxes. Soft shadows around every one of those stack into mush, and a table
with pillowy rows stops reading as a table. D3 is where that gets decided.

## Decisions

### The scale

- [x] **D1.** Replace the eleven ad-hoc radii now spread across four files
      (`rounded-[5px]`, `[7px]`, `[9px]`, `[10px]`, `[11px]`, `lg`, `md`, `xl`,
      …) with a four-step scale as `@theme` tokens: `sm` 8px for chips inside
      rows, `md` 12px for controls, `lg` 16px for cards and rows, `xl` 22px for
      containers. Full circles stay `rounded-full`.
- [x] **D2.** Add elevation tokens rather than per-element shadow classes:
      `--shadow-rest` and `--shadow-raised`, each a two-layer shadow (a tight
      contact shadow plus a wide ambient one), redefined per theme.
- [ ] **D3. pick ONE** — how far the elevation goes:
  - [x] **D3a. Calibrated.** Elevation on the things you act on — tool cards,
        tournament rows, match cards, the appearance control. Data-dense
        surfaces — the standings table, the bracket boxes — stay flat and
        separate by tone alone. *(Recommended: keeps ten stacked match cards and
        a 13-box bracket legible at 340px.)*
  - [ ] **D3b. Everywhere.** Every surface gets the same treatment, tables and
        bracket included. Closest to the reference; densest screens get soft.

### Surfaces

- [x] **D4.** Drop `border border-border` from every card, row, control and
      table in favour of tone + shadow. Keep the token: dividers inside a
      surface (the match card's footer rule, table row rules) still need it.
- [x] **D5.** Give dark mode a `--edge` inner highlight
      (`inset 0 1px 0 rgba(255,255,255,0.06)`) folded into the elevation
      tokens. Without it a dark card on a dark page has no top edge at all —
      this is the single detail that makes the reference's dark half work.
- [x] **D6.** Step the light-mode page background down (`#ececee`-ish) so a
      white card has something to sit on. Today's near-white page and white
      cards are only separable by the hairline being removed.
- [x] **D7.** Keep a `1px solid transparent` border on elevated surfaces. It is
      invisible normally and becomes a real edge under Windows high-contrast /
      `forced-colors`, where box-shadows are dropped entirely. Cheap insurance
      against the one accessibility hole this style has.

### Components

- [x] **D8.** Icon chips become circles: the tool mark, the appearance segments'
      resting state, and the league/team logo chips.
- [x] **D9.** Hover raises rather than tints — `--shadow-raised` plus one step
      lighter — on tool cards, tournament rows and match cards. Focus stays a
      ring, not a shadow, so keyboard focus never reads as hover.
- [x] **D10.** A switched-off tool dims its whole card (like the reference's
      finished row) instead of only losing its accent border.

### Verification

- [x] **D11.** Extend `scripts/preview-popup.ts` with the checks this style can
      fail silently: that elevated surfaces resolve a non-`none` `box-shadow` in
      both themes, and that no card keeps a visible border.
- [x] **D12.** Re-shoot every screenshot in both themes, since all of them
      change.

## Out of scope

- Any change to colour, type, copy, layout order or behaviour.
- The Pinterest content stylesheet — it restyles Pinterest's markup, not ours.
- Animation beyond the hover/focus transitions already present.

## Files touched

| File                                     | Change                                    |
| ---------------------------------------- | ------------------------------------------ |
| `src/popup/style.css`                    | radius + elevation tokens, per theme      |
| `src/popup/index.html`                   | app bar, views, back row                  |
| `src/popup/index.ts`                     | cards, switch, segments, chips            |
| `src/tools/t1-tracker/panel.ts`          | match cards, tournament rows              |
| `src/tools/t1-tracker/tournament.ts`     | table, bracket boxes                      |
| `scripts/preview-popup.ts`               | elevation checks, fresh screenshots       |
| `README.md`                              | what the design system is now             |

## Implementation notes

**Two of my own checks were measuring nothing.** The first pass asserted "no
visible border" against `.tool-card, .t1-card, .t1-tourney` and "tables stay
flat" against `.t1-table, .t1-bout` — both from the dashboard screen, where
none of the tool's surfaces exist yet. They passed by matching zero elements.
Each now runs on the screen where its subject is on screen and asserts the
count it expects (`8 surfaces, 0 flat, 0 bordered`; `6 surfaces, 0 raised`), so
an empty match fails instead of passing.

**The live match keeps its red edge.** It is the one border left on a card. It
marks a state rather than a structure, so the borderless check exempts
`data-state="inProgress"` explicitly rather than quietly tolerating it.

**Light-mode hover needed a tonal step to have anything to say.** `--surface`
is now `#fbfbfc` rather than pure white, so `--surface-hover` at `#ffffff` is a
real change; on a white-on-white pair the raise would have been shadow alone.

Verified with `bun run typecheck`, `bun run build` and `bun run preview:popup`
(61 checks, all passing, stable over repeated runs), plus fresh screenshots of
the dashboard, the schedule and the bracket in both themes.
