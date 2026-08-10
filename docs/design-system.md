# Design system

What the popup is made of, and the reasoning behind the parts that are easy to
undo by accident. Every value here is quoted from
[`src/popup/style.css`](../apps/chrome-extension/src/popup/style.css) and
[`src/common/ui.ts`](../apps/chrome-extension/src/common/ui.ts) — if the two disagree, the code is
right and this file is stale.

Scope is **the popup only**. `apps/chrome-extension/src/tools/pinterest-theme/theme.css` restyles
Pinterest's own markup and shares none of this.

---

## Where things live

| File | Holds |
| --- | --- |
| `apps/chrome-extension/src/popup/style.css` | The Tailwind entry: tokens, base layer, the two things utilities can't say |
| `apps/chrome-extension/src/common/ui.ts` | `button()`, `segmented()`, `switchControl()`, `menu()` |
| `apps/chrome-extension/src/common/icons.ts` | Renders Hugeicons' icon data into an `<svg>` |
| `apps/chrome-extension/src/popup/tool-ui.ts` | Per-tool icon and panel renderer, keyed by tool id |

`ui.ts` and `icons.ts` sit in `common/`, not `popup/`, because the T1 panel
draws with them — and a tool importing from `popup/` would invert the one-way
dependency the panel contract keeps. No content script imports either.

---

## Colour

The palette carries **no brand hue**. `--accent` is full-strength ink: near-black
on light, white on dark. Emphasis comes from muting whatever it competes with,
not from colouring the thing you want noticed.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | `#ececee` | `#0b0c0f` | The page. Stepped down on light so cards have something to sit on |
| `--surface` | `#fbfbfc` | `#17181d` | Cards, menus, the raised segment chip |
| `--surface-hover` | `#ffffff` | `#202229` | One step nearer, on hover |
| `--sunken` | `rgba(9,11,16,.035)` | `rgba(0,0,0,.25)` | Segmented track, match-card footer |
| `--border` | `#e4e5ea` | `#262a33` | Dividers **inside** a surface only |
| `--text` | `#16181f` | `#e8eaf0` | Body copy |
| `--muted` | `#6b7280` | `#8b91a3` | Secondary copy, and anything stepping back |
| `--accent` | `#0b0d12` | `#ffffff` | Selected, enabled, emphasised |
| `--accent-soft` | `rgba(11,13,18,.07)` | `rgba(255,255,255,.1)` | Chip fills, the T1 row tint |
| `--on-accent` | `#ffffff` | `#0d0f13` | **Anything drawn on top of `--accent`** |
| `--track` / `--thumb` | `#d3d6dd` / `#fff` | `#2f3441` / `#a4a9b4` | Switch, off |
| `--logo-bg` | `#232936` | `transparent` | Behind team and league logos |
| `--win` `--loss` `--live` `--warn` | green / red / red / amber | brighter equivalents | The only colours left, and each means something |

### `--on-accent` is not optional

Hard-coding `text-white` on top of `--accent` breaks exactly one of the two
themes, and always the one you are not looking at. Light mode paints white on
near-black and looks fine; dark mode paints white on white.

### Three states, not two

An explicit choice stamps `data-theme` on `<html>`; **System stamps nothing**.
So light is the bare `:root` palette, dark arrives either from
`prefers-color-scheme` or from `[data-theme="dark"]`, and each is written out in
full in both places. Never give a colour its only definition inside the media
query — the toggle then can't win in both directions.

`apps/chrome-extension/src/common/appearance.ts` holds the value;
`apps/chrome-extension/src/popup/theme.ts` applies it at
module top level, before first paint, from a `localStorage` mirror. An extension
page cannot run an inline script (MV3's CSP is `script-src 'self'`), so that is
the earliest hook available.

---

## Type

**Geist** (SIL OFL), bundled as one variable file, not fetched. A popup has to
paint immediately and offline, and the variable file is the only way the
`font-[650]` weights in use actually resolve — no static cut has 650.

`font-display: block`, not `swap`: the file is a local extension resource so it
cannot fail to arrive, and swapping would flash the fallback for a frame in a
window that paints once.

The build copies it in `build:popup:assets`. Skip that step and everything
quietly falls back to the system stack, which is why
`apps/chrome-extension/scripts/preview-popup.ts` asserts `document.fonts.check('600 14px Geist')` as
well as the computed family.

---

## Shape

### Radius

Four steps, replacing eleven ad-hoc values that had spread across four files.

| Token | Value | For |
| --- | --- | --- |
| `rounded-sm` | 8px | Chips inside a row |
| `rounded-md` | 12px | Controls, buttons, bracket boxes |
| `rounded-lg` | 16px | Cards, menu containers, segmented tracks |
| `rounded-xl` | 22px | Containers |

`rounded-full` for switches and circular logos. **No `rounded-[…]` anywhere** —
an arbitrary value is a sign the scale needs a step, not an exception.

### Elevation

Separation is tone plus shadow, not a hairline.

- `shadow-rest` — where a card sits
- `shadow-raised` — where it lifts on hover

Both resolve per theme, and both carry `--edge` in dark: an
`inset 0 1px 0 rgba(255,255,255,.06)` highlight along the top. Without it a dark
card on a dark page has no edge at all. It is the single detail that makes the
dark half work.

**Two deliberate exceptions:**

1. **Dense surfaces stay flat.** The standings table and the bracket boxes
   separate by tone alone. Ten stacked shadows at 340px read as mush, and a
   pillowy table stops reading as a table.
2. **Every elevated surface keeps `border: 1px solid transparent`.** Invisible
   normally; Windows high-contrast (`forced-colors`) drops `box-shadow`
   outright, and without it those cards would lose their edges entirely there.
   `style.css` turns that border to `CanvasText` under `forced-colors`.

---

## Icons

Hugeicons' free **Stroke Rounded** set (`@hugeicons/core-free-icons`, MIT).

Their packages ship icons as data — a list of `[tag, attributes]` pairs on a
24×24 grid — with renderers for React, Vue, Angular and Svelte. This popup has
none of those, so `common/icons.ts` renders the same data.

Two things that data does that the DOM doesn't:

- Attributes are React-shaped (`strokeLinecap`), so they are kebab-cased on the
  way in, and the `key` prop is dropped.
- The nodes set `stroke` and leave `fill` alone. **The root `<svg>` must set
  `fill="none"`** or every icon renders as a black silhouette.

Import one icon at a time; that is what keeps the other 5,400 out of the bundle.
The tool marks live in `popup/tool-ui.ts`, **not** in the registry — a tool's
definition reaches every content bundle, and an icon there costs ~2.4KB on every
page the tool runs on.

---

## Components

All four in `apps/chrome-extension/src/common/ui.ts`, all matching supplied references with `--accent`
standing in for the reference's blue.

### `button(label, { variant, icon, onClick })`

| Variant | Fill | Text |
| --- | --- | --- |
| `primary` | `--accent` | `--on-accent` |
| `secondary` | `--surface` + hairline + `shadow-rest` | `--text` |
| `soft` | `accent/10` | `--accent` |
| `danger` | `--loss` | white |

`rounded-md`, one size, optional trailing icon.

> **Nothing calls this yet.** It was built to a reference for the next screen
> that needs one. Until something uses it, it is dead code — deliberately, and
> worth knowing before you go looking for its usage.

### `segmented({ name, ariaLabel, items, value, onChange })`

A **sunken track** with the selected item as a **raised `--surface` chip** —
selected reads as *nearer*, not as inverted. Unselected is `--muted`, stepping
to `--text` on hover. An item with an `icon` renders the icon and keeps its
label as screen-reader text.

### `switchControl({ id, ariaLabel, checked, onChange })`

44×26 track, 22px knob. The knob is a **ring, not a disc**: a solid circle in
the track's contrast colour with an 8px dot back in the track's own colour.

| | Track | Knob | Dot |
| --- | --- | --- | --- |
| On | `--accent` | `--on-accent` | `--accent` |
| Off | `--track` | `--surface` | `--track` |

That inversion is why it survives both themes. A fixed white knob vanishes on
the white track dark mode gives it.

Track, knob and dot are all **siblings of the input**. `peer-*` only reaches
forward across siblings, so nesting the dot inside the knob would put it out of
range of `:checked`; instead both translate the same 18px.

### `menu(rows)`

A list reads as a list: **one raised container, flat rows, hairline dividers**.
Each row takes a chip (a rounded square, `MENU_CHIP`), a title, an optional
subtitle, and optional trailing content. `onOpen` makes the chip-and-text block
a button.

Rows do **not** lift on hover — raising one row out of a divided stack breaks
the rules either side of it. They tint instead.

Only things that are *not* lists stay individually elevated: the match cards.

---

## Rules that bite

**Never build a class name by concatenation.** Tailwind finds classes by
scanning source text, so `` `t1-side-${position}` `` compiles to no CSS at all.
Conditionals pick between whole literal strings; shared strings are `const`s.

**`@source` is `"../"` — all of the app's `src/`, not a list of directories.** The list
version silently dropped `src/common` the day the shared components moved
there: the class names stopped being scanned, `has-[:checked]:bg-surface`
compiled to nothing, and the segmented control lost its selected state *while
still carrying the class*. The DOM looked perfect. Only a test that asserted the
**painted** background caught it.

**Assert what is painted, not what the DOM says.** A control that lights the
wrong segment passes an `input.checked` check cleanly. And when you read a
computed style straight after a click, wait out the 150ms `transition-colors`
first, or you will measure the interpolated value and misdiagnose a bug that
isn't there.

**A test that matches zero elements passes.** Two of the elevation checks were
written against the dashboard, where the T1 tool's surfaces don't exist yet;
both passed by selecting nothing. Assert a **count**, and run the check on the
screen where its subject is on screen.

**A mount point draws nothing.** `#appearance`, `#tool-list` and
`#detail-switch` are bare `<div>`s. Every component brings its own surface,
padding and ARIA, so anything styled on the mount wraps it in a second one —
which reads in code as two harmless class lists and on screen as a pill inside
a pill, with two nested `role="radiogroup"`s. This shipped once and was spotted
by eye, not by a test; there is now a check that every mount resolves to no
background, border, shadow or padding.

**Popup-only code stays out of content bundles.** `registry.ts` is reached by
every content script through `storage.ts`, so anything hanging off a tool
definition ships to every page that tool runs on. Panels and icons are keyed by
tool id in `popup/tool-ui.ts` for that reason. `bun run build` prints both
bundle sizes; `pinterest-theme.js` should stay around 8KB.
