---
status: done
assignees: []
created_at: 2026-08-08 00:00:00Z
priority: medium
tags: ["popup", "css", "tailwind", "theming"]
---

# Review: Tailwind, appearance modes, and a bigger popup

Three changes to the popup, asked for together:

1. Give every screen the room the tournament view has.
2. Add Dark / Light / System appearance, defaulting to System.
3. Move the popup's styling to Tailwind CSS.

**Approved verbally on 2026-08-08** ("ok làm đồng bộ / chạy thôi") rather than
box by box; ticked here to match. D3 was the one flagged for a second look and
is explicitly accepted — one size everywhere, sparse Pinterest screen included.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a
`> note` under any you don't. Implementation starts only after every box is
`[x]`.

## Context

Already settled with the user before this checklist:

- **The whole popup** is one size — dashboard, Pinterest and T1 alike — rather
  than only widening for the T1 tool.
- Tailwind is used the **idiomatic way**: utility classes in the TypeScript that
  builds the DOM. The existing semantic names stay as bare hooks with no styles
  of their own, because `scripts/preview-popup.ts` asserts against 26 of them.

Verified while writing this:

- Tailwind v4.3.3 installs under bun and its CLI compiles a v4 entry file with
  arbitrary values (`grid-cols-[62px_1fr_auto_1fr]`), `@apply`, and a custom
  `data-theme` dark variant. 8.5KB out for a trivial input.
- Chrome caps a browser-action popup at **800×600**. With the 57px app bar, a
  scroll region above ~530px is all there is.
- `src/popup/style.css` is 972 lines today; `theme.css` (the Pinterest
  override) is a separate 421 lines.

## Decisions

### Size

> **Reversed on 2026-08-08, after seeing it.** The user asked for the popup to
> go back to 340px everywhere and for only the tournament detail to widen —
> which is the `t1-wide` mechanism D2 had just deleted, so it came back. D3's
> sparse Pinterest screen was the cost being paid for D1, and both are gone with
> it. See the implementation notes.

- [x] **D1.** Fix the popup at **780px wide**, and the scroll region at
      **530px**, on every screen. Chrome's ceiling is 800×600 and the app bar
      takes 57px of it, so this is essentially "as large as it goes".
- [x] **D2.** Delete the `t1-wide` marker and the `body:has(.t1-wide)` rule
      along with it. With one size everywhere there is nothing left for it to
      do, and the tool stops needing to ask the shell for room at all.
- [x] **D3.** Accept that the Pinterest screen — one switch and three
      segments — looks sparse at this width. The alternative is a popup that
      resizes as you navigate, which the user turned down.

### Appearance

- [x] **D4.** Three states, `system` (default) / `dark` / `light`, stored in
      `chrome.storage.sync` under `fz.appearance.v1` so it follows the profile
      like tool state does.
- [x] **D5.** Apply as `data-theme` on `<html>`: `dark` and `light` stamp the
      attribute, `system` stamps **nothing** and lets `prefers-color-scheme`
      decide. Never give a colour its only definition inside a media query.
- [x] **D6.** Mirror the choice into the popup's own `localStorage` and read it
      synchronously at module top level, before `DOMContentLoaded` — the same
      trick the content scripts already use, and for the same reason: reading
      `chrome.storage` is async, and async means "after the popup painted in
      the wrong theme".
- [x] **D7.** Put the control in the app bar as a three-way segmented switch.
      It is the one setting that belongs to the popup rather than to any tool,
      so it does not go in the registry.
- [x] ~~**D8.** Keep the Pinterest tool's own Auto/Dark/Light setting
      untouched.~~ **Reversed on 2026-08-08:** the user asked for one appearance
      to drive both, with the tool's switch only deciding whether to apply it.
      They are one thing that happened to be modelled as two.

### Tailwind

- [x] **D9.** Add `tailwindcss` + `@tailwindcss/cli` and replace the popup's
      `cp style.css` build step with a Tailwind compile. `bun run dev` gets a
      `--watch` alongside the existing two.
- [x] **D10.** Define the palette as plain custom properties in `@layer base`
      under the three-state pattern from D5, then expose them to Tailwind with
      **`@theme inline`** so `bg-surface` compiles to `var(--color-surface)`
      rather than a baked hex. That is what lets one set of utilities follow the
      theme with almost no `dark:` variants in the markup.
- [x] **D11.** Never build a class name by concatenation. Tailwind finds classes
      by scanning source text, so a name assembled at runtime silently produces
      no CSS. Anything conditional picks between whole literal strings.
- [x] **D12.** Leave `src/tools/pinterest-theme/theme.css` hand-written and out
      of the Tailwind build. It restyles Pinterest's markup, not ours — there
      are no elements of ours to put utilities on.
- [x] **D13.** Keep hand-written CSS for the few things utilities can't state:
      the bracket's SVG connectors, and the `::-webkit-scrollbar` styling the
      wider popup now makes visible.

### Verification

- [x] **D14.** Extend `scripts/preview-popup.ts`: the new fixed width, the
      appearance control switching `data-theme`, the choice surviving a reload,
      and `system` leaving no attribute behind. Update the ~30 assertions that
      currently expect a 340px popup that widens.
- [x] **D15.** Screenshot the dashboard and the T1 schedule in **both** themes,
      so a light-mode regression is visible in `.preview/` rather than only in
      someone's eyes.

## Out of scope

- Theming the Pinterest content script from this setting.
- A per-tool appearance override.
- Any change to what the T1 tracker fetches or renders — this is the same
  screens at a different size and in two palettes.
- Tailwind for anything outside `src/popup/` and `src/tools/*/panel.ts`.

## Files touched

| File                                     | Change                                          |
| ---------------------------------------- | ------------------------------------------------ |
| `package.json`                           | tailwind deps, compile + watch steps            |
| `src/popup/style.css`                    | becomes the Tailwind entry: tokens and the rest |
| `src/popup/theme.ts`                     | new — read, write, mirror and apply appearance  |
| `src/popup/index.ts`                     | utilities, and the appearance control           |
| `src/tools/t1-tracker/panel.ts`          | utilities                                       |
| `src/tools/t1-tracker/tournament.ts`     | utilities                                       |
| `scripts/preview-popup.ts`               | size, theme, and the assertions that shift      |
| `README.md`                              | the build step and the new setting              |

No manifest change: Tailwind compiles to a plain stylesheet, so the popup's
CSP is unaffected and no new permission is involved.

## Implementation notes

**A bug I reported that wasn't one.** A screenshot showed two segments of the
appearance control lit at once, so I rewrote `segment()` from `has-[:checked]`
onto the `peer` pattern and wrote a comment blaming Chrome's `:has()`
invalidation. Probing properly showed the selector matched correctly all along:
`transition-colors` runs 150ms, and both the screenshot and the assertion were
reading the interpolated value mid-transition. The rewrite was reverted and the
original pattern kept; what the episode actually earned was two assertions on
the *painted* background — the old ones checked `input.checked`, which a control
that lights the wrong segment passes cleanly.

**Two real bugs in the harness, found the same way.** Persisting the storage
shim so the appearance choice could survive a reload also persisted it across
*runs*, because the Chrome profile lives in `/tmp` — one run's tool state leaked
into the next run's assertions. sessionStorage fixed it. And `.segment` stopped
being unique the moment the appearance control existed, so the Pinterest
setting's assertions were counting six segments; those are now scoped to
`#detail-body`.

**`source(none)`.** Tailwind's automatic project scan reached `.agents/` and
compiled class names out of these review notes — a stale
`grid-cols-[62px_1fr_auto_1fr]` from an earlier draft was in the output. The
entry now names its two source directories and nothing else.

**D2 paid for itself.** With one popup size, `t1-wide` and the `body:has()` rule
written earlier the same day both went; the tool no longer asks the shell for
room at all.

**D1–D3 were reversed after the user saw them.** One size everywhere made the
Pinterest screen sparse — accepted in advance — but it also cramped the app bar
the other way once we went back: three text segments took 150px of a 340px bar
and wrapped the extension's own name onto a second line. The control is now
three icons with screen-reader labels, at 107px. `t1-wide` came back for the
tournament view alone, this time in the **utilities** layer: in `base` it lost
to the `w-[340px]` utility on `<body>`, because layer order outranks
specificity. The harness caught that immediately — the widening check failed on
the first run.

**D8 was reversed too, and it moved code.** With the Pinterest theme following
the extension's appearance, that value stopped being a popup concern: it now
lives in `src/common/appearance.ts`, because a content script importing anything
under `popup/` drags the dashboard's DOM into every content bundle. Each surface
mirrors it into its own origin's localStorage, exactly as the tool states
already do. Verified afterwards that `pinterest-theme.js` carries the appearance
key and nothing else — no `data-theme`, no `tool-card`, no utilities.

That reversal had a consequence worth naming: with its only setting gone, the
Pinterest tool has nothing behind its card, so `openable` stops making it a
button and the chevron disappears. That is the registry behaving as designed —
the dashboard switch already is the whole tool — but it is a visible change, not
a side effect to leave unmentioned.

`style.css` went from 972 lines to 181. Verified with `bun run typecheck`,
`bun run build`, and `bun run preview:popup` (52 checks, all passing, stable
over repeated runs), plus a live run against the real API at the new width.
