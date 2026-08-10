---
status: done
assignees: []
created_at: 2026-08-09 00:00:00Z
priority: medium
tags: ["popup", "css", "design-system", "components"]
---

# Review: four shared components

Restyle Button, Segmented control, Switch and Menu to match the four references
supplied, substituting our accent (near-black on light, white on dark) for the
reference's blue.

**How to review:** flip `- [ ]` to `- [x]`; add a `> note` under any you don't
agree with. "chạy thôi" takes the recommended option everywhere.

## What I read from each image

**Button** — four variants: solid accent with inverted text; white with a
hairline, a soft shadow and an optional trailing arrow; a tinted fill with
accent text; and a solid red destructive. Radius is a squircle, not a pill.

**Segmented** — a **grey track** with the selected item as a **raised white
chip**. Unselected items are muted text on the track itself, and the middle one
in the shot is a hover state, one step darker than the third.

**Switch** — the knob is a **ring, not a disc**: a solid circle in the track's
contrast colour with a smaller inner dot back in the track's own colour. Track
fully round, knob nearly filling its height, soft shadow under the knob.

**Menu** — a **tinted container with hairline dividers**, not separate cards.
Rows are flat inside it; each has a **rounded-square** chip, a bold title with
a muted secondary line, and a trailing action. A status dot overlaps the chip.

## Three of these contradict what shipped this morning

Not objections — the user has seen the result and is overriding. Worth naming
so each is a decision rather than a drift:

| Shipped today | These references |
| --- | --- |
| Cards separated by gaps, each elevated (`shadow-rest`) | One tinted container, flat rows, hairline dividers |
| Icon chips are circles (D8, yesterday) | Icon chips are rounded squares |
| Selected segment is a filled accent pill | Selected segment is a raised white chip on a grey track |

## Decisions

### Where they live

- [x] **D1.** Put all four in one `src/popup/ui.ts` as functions returning
      elements — `button()`, `segmented()`, `switchControl()`, `menu()` — and
      have `index.ts` and the T1 panel call them instead of hand-writing the
      class strings each time. Today the switch and segment markup exist once in
      `index.ts` and the card/row styling is copied between three files.
- [x] **D2.** Keep the existing semantic hooks (`.switch-input`, `.segment`,
      `.tool-card`) on whatever these emit, so the 61 assertions keep pointing
      at real things.

### Button

- [x] **D3.** Four variants: `primary` (accent fill, `--on-accent` text),
      `secondary` (surface, hairline, `shadow-rest`), `soft` (`--accent-soft`
      fill, accent text), `danger` (`--loss` fill, white text). Optional
      trailing icon, `rounded-md`, one size.
- [x] **D4.** Ship it even though **nothing currently uses it** — this popup has
      no button-shaped affordance today. It is a component built for the next
      screen, not a restyle of an existing one, and it will be dead code until
      something calls it. *(Recommended: the user asked for it explicitly; say
      so rather than quietly skipping it.)*

### Segmented and Switch

- [x] **D5.** Segmented: track becomes `--sunken`, the selected item a
      `--surface` chip with `shadow-rest` and full-strength bold text;
      unselected stays muted and steps to `--text` on hover. Replaces today's
      filled-accent pill.
- [x] **D6.** Switch: knob becomes a ring — `--on-accent` circle with an inner
      dot in `--accent` when on, `--surface` circle with a `--track` dot when
      off. This keeps working in both themes, where a fixed white knob would
      vanish on the white track dark mode gives it.
- [x] **D7.** Grow the switch to 44x26 with a 22px knob so the inner dot has
      room to read. Today's 38x22 leaves about 6px of knob after the ring.

### Menu

- [x] **D8. pick ONE** — how far the grouped-list style goes:
  - [x] **D8a.** The dashboard tool list **and** the Tournaments list become
        menus: one tinted container, flat rows, hairline dividers, rounded-square
        chips. Elevation stays on the match cards, which are not lists.
        *(Recommended: matches the reference and keeps one list idiom.)*
  - [ ] **D8b.** Only the dashboard becomes a menu; the Tournaments list keeps
        today's separate raised rows.
- [x] **D9.** Chips inside a menu row go back to rounded-square (`rounded-md`),
      reversing yesterday's D8. Circles stay on the team and league logos, which
      are not menu rows.
- [x] **D10.** Drop the per-row hover lift inside a menu — a flat row in a
      container tints on hover instead. Raising one row out of a divided list
      breaks the dividers either side of it.

### Verification

- [x] **D11.** Assert what each component's shape actually resolves to, not just
      that it renders: the selected segment is raised and light rather than
      filled-accent; the switch knob has an inner dot; menu rows carry dividers
      and no shadow. Today's elevation checks assume every surface is raised and
      will need narrowing to the ones that still are.
- [x] **D12.** Re-shoot every screenshot in both themes.

## Out of scope

- Colour, type, copy, layout order, behaviour.
- The match card, the standings table and the bracket — none is one of the four.
- The status dot overlapping a menu chip: nothing in this popup has that state.

## Files touched

| File                                     | Change                              |
| ---------------------------------------- | ------------------------------------ |
| `src/popup/ui.ts`                        | new — the four components           |
| `src/popup/style.css`                    | any tokens the components need      |
| `src/popup/index.ts`                     | call them; dashboard becomes a menu |
| `src/tools/t1-tracker/panel.ts`          | Tournaments list becomes a menu     |
| `scripts/preview-popup.ts`               | shape assertions, fresh screenshots |
| `README.md`                              | the component set                   |

## Implementation notes

**The components moved to `common/`, not `popup/`.** D1 said `src/popup/ui.ts`,
but the Tournaments list is drawn by `src/tools/t1-tracker/panel.ts`, and a tool
importing from `popup/` inverts the dependency the panel contract deliberately
keeps one-way — the same reason `icons.ts` sits in `common/`. Verified after:
the Pinterest content bundle still carries none of it.

**That move silently broke the segmented control, and the harness caught it.**
`style.css` scanned `@source "../popup"` and `"../tools"` — never `../common`.
The moment the shared components landed there, Tailwind stopped seeing their
class names, so `has-[:checked]:bg-surface` compiled to nothing. The DOM was
perfect: the input was checked, `:has(:checked)` matched, the class was on the
element — and the chip was still transparent. The fix is `@source "../"`, all of
src. The "exactly the chosen segment is lit" assertion — added a day earlier
after a *false* alarm on this same control — is what failed. It earned its
place.

**Nine assertions had to change shape, which was the point of D11.** Four
described a dashboard of separate elevated cards that no longer exists, and
five pointed at hooks the shared components renamed (`.tool-name` →
`.menu-title`, `button.tool-main` → `button.menu-open`, `data-appearance` →
`data-value`). Rather than loosen them, each now asserts the new truth with a
count: `raised container, 2 rows, 0 lifted`; `plain,ruled`; `6 cards, 0 flat,
0 bordered`; `2 rows, 0 lifted, 1 ruled`. An empty match fails.

**A dead-hook audit now runs as part of the change**, comparing every selector
in the harness against the source. It found `.tool-name` still being used by the
font check, which would otherwise have quietly measured nothing.

Verified with `bun run typecheck`, `bun run build` and `bun run preview:popup`
(63 checks, all passing over four consecutive runs), plus fresh screenshots in
both themes.
