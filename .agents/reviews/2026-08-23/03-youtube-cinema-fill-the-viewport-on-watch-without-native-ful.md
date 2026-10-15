---
status: done
schema: 1
task_id: FE-05
category: frontend
assignees: ["fuongz"]
created_at: 2026-08-23 00:00:00Z
priority: medium
tags: ["tool", "chrome-extension", "css"]
---

# Review: YouTube Cinema — fill the viewport on /watch without native fullscreen

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Context

A YouTube watch page never gives the video the whole window: even in theater mode the
masthead stays on top and the title, channel row, comments and related rail sit below,
so the only way to fill the screen is native fullscreen — which hides the browser's own
chrome and the menu bar. Netflix's player does the thing that is wanted here: the video
fills the *viewport*, the OS window stays a window.

This adds a fifth extension tool, **YouTube Cinema**, a page tool on `youtube.com` in
the shape of Pinterest Dark/Light: a stylesheet that is inert without an attribute on
`<html>`, and a `document_start` content script that owns the attribute, gated on the
tool's own switch through `readMirroredStates()`.

The mechanism is one fixed-position player rather than a relayout of YouTube's grid.
`ytd-watch-flexy #movie_player` is pinned to `inset: 0` above the masthead's stacking
order, the video element's JS-written inline geometry is overridden with
`object-fit: contain` so it letterboxes exactly as fullscreen does, and a synthetic
`resize` lets YouTube's own player re-measure its controls. Everything the tool hides —
masthead, guide, `#below`, `#secondary` — is belt and braces plus `overflow: hidden`,
not what makes the video big.

The surface grew over the session, each step on the user's call: a toggle in the
player's control bar (D7), two independent settings over it instead of one either/or
picker (D2), a way home over the video now that the masthead is gone (D9), and the icon
redrawn on YouTube's current grid after the first attempt shipped as a white block
(D10).

## Decisions

- [x] **D1.** **Engage automatically** on every `/watch` page, with `Shift+F` (and `Escape`) to drop back to the normal layout — chosen over hotkey-only, and over auto-with-no-way-out. *(recommended)*
- [x] **D2.** **Two independent settings** — *Every video* and *Shift+F hotkey*, each on/off — rather than one `engage` picker choosing between them. They are complements, not alternatives: the button in the player works with both off, which is the floor they build on. (Supersedes the single `engage` setting this card started with.)
- [ ] **D7.** **A toggle in the player's control bar**, immediately before fullscreen, present whether cinema is on or off — so nothing about the tool requires knowing a keyboard shortcut.
  > Dropped on the user's call, and with it D8 and D10. Four versions of a control-bar toggle shipped and were rejected in one session: hand-drawn filled screen (a white block), SVG Repo film strip at 20 units then 14 (still outweighing the outline icons beside it), and a pill switch copying the player's own autoplay control (right weight, but a few pixels off the others' line — the group it sits in is taller than the 40px buttons, so a full-height box centres its glyph low). The bar is Google's, rebuilt without warning, and a control that never quite looks native is worse than none. The in-page surface is now the way home (D9) plus the hotkey; `.fz-cinema-button` and its CSS are gone, and the harness's toggle assertions were rewritten onto the way home. Consequence worth knowing: with the *Shift+F hotkey* setting off and *Every video* off, the tool has nothing left to act on — it is parked rather than broken, but there is no in-page way in.
- [x] **D9.** **A way home over the video's top left**, appearing and fading with the player's own controls (by following its `ytp-autohide` class rather than tracking the pointer), going to `youtube.com` with a plain navigation. Cinema hides the masthead, and with it the only thing on the page that goes home; it belongs to cinema, so it is gone the moment the video is not filling the window.
- [x] **D10.** **Both icons on YouTube's current 24x24 grid**, stroked outlines at 2 units with round joins, rather than the 36x36 filled shapes the player used to use — the first attempt's "solid screen" state rendered as a blank white block next to the real controls. Four candidates were rendered at the size it actually ships at (48x40) before choosing the screen-with-arrows pair.
  > Superseded by the user's own pick: the toggle now uses `cinema-screen` from SVG Repo — a screen between two perforated side panels — kept as drawn and moved onto YouTube's 24x24 grid with a group transform (`translate(2,2) scale(0.3614)`). One glyph for both states: the screen is filled while cinema is on and outlined, over exactly the same footprint, when it is not. The hand-drawn screen-with-arrows pair this replaces is in the session's local renders if it is ever wanted back. Worth confirming the licence SVG Repo lists for that specific icon before this ships anywhere public.
  > Settled, on the user's call: the control is a **switch**, not a picture — the same 18x10 pill on the same 24x24 grid as the player's own autoplay control, knob left when the video is in the page and right when it fills the window. Three attempts got here: a hand-drawn filled screen (a white block), the SVG Repo film strip at 20 then 14 units (still too heavy beside the outline icons, at both sizes), and finally the pill. The pill also brings its own white background, which is the one thing that reads reliably over arbitrary video. The SVG Repo artwork is no longer used, so its licence is no longer a question.
- [x] **D8.** Anchor the control-bar button against **the fullscreen button's own parent** (`.ytp-right-controls-right`), falling back to `.ytp-right-controls` — YouTube nests the right-hand controls a level deeper than it used to, and `insertBefore` against a node that is not a child throws (which it silently did, inside a promise, until the harness caught it).
- [x] **D3.** Pin `#movie_player` with `position: fixed` scoped under `ytd-watch-flexy`, rather than relayouting `#columns` — the scope is also what keeps the miniplayer (a different parent) from being blown up to full size.
- [x] **D4.** Override the video element's inline `width`/`height`/`left`/`top` with `object-fit: contain` so a mis-measured player still letterboxes correctly, and dispatch `resize` so YouTube re-measures its own controls.
- [x] **D5.** Stand down entirely while native fullscreen is active — attribute dropped, toggle hidden, way-home removed — and restore on exit, so `f` still behaves exactly as YouTube's own fullscreen.
- [x] **D6.** Off by default (`defaultEnabled: false`), like every tool added after Pinterest — switching it on is what makes the content script do anything.

## Verify

- [x] **V1.** `bun run gate` — build + lint + typecheck green.
  > Green. Also added `bun run preview:youtube` — the same CDP harness the Pinterest theme uses, pointed at two real watch pages (one 4:3, for the letterboxing assertion). All checks pass: player 1400x813 in a 1400x813 viewport, video filling it with `object-fit: contain`, masthead / `#below` / `#secondary` / mini-guide at zero height, control bar 1376px = viewport − 24, no scroll, and removing the attribute back to a 929x697 grid player under a 56px masthead. V2–V5 are the content script's half and still need Load unpacked.
- [x] **V2.** `bun run preview:youtube` — the built stylesheet **and** bundle over two real watch pages against a `chrome.storage.sync` stand-in: the layout, the 4:3 letterboxing, the toggle's placement / labels / real mouse press, Shift+F, Escape, `f` into real fullscreen and back, either setting off leaving the button working, the switch going off taking the attribute and the button with it, and a warm-start boot (page two, mirror already written) still mounting everything.
- [x] **V3.** `bun run preview:popup` — the dashboard still renders from the registry with a fifth tool and its two settings.
- [x] **V6.** **Eyeball it in a real browser** (the user's call, and the only check for everything after the harness last ran): the toggle's two states next to the real controls, the way-home arrow appearing and fading with the player's controls and reaching youtube.com, and the redrawn icons at their shipping size.
- [x] **V4.** Load unpacked once: the manifest parses, the tool appears in the popup, and a real watch page in a real profile behaves.
- [x] **V5.** Load unpacked: click a related video and check the next watch page opens in cinema again (a client-side route change, which a headless tab cannot reach), and that a non-watch page is left untouched.

## Out of scope

- Netflix, and any other site — this tool is `www.youtube.com` only (YouTube Music is a different app under the same domain and is deliberately not matched).
- Shorts, the embedded player, and `youtube.com/live/` chat layouts beyond what the watch page itself does.
- Routing home through YouTube's own client-side router instead of a plain navigation — it would be faster but depends on a hidden masthead link being clickable.
- Remembering per-video or per-tab whether cinema was dismissed — each watch page starts from the *Every video* setting.
- Hiding the browser's own chrome, which is what native fullscreen is for.
- A configurable keyboard shortcut; Shift+F is the one, and it can be turned off.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/youtube-cinema/constants.ts` | new — tool id, the `<html>` attribute, both button classes, the two setting keys, the home URL |
| `apps/chrome-extension/src/tools/youtube-cinema/definition.ts` | new — registry entry with the two on/off settings |
| `apps/chrome-extension/src/tools/youtube-cinema/content.ts` | new — document_start script owning the attribute, the control-bar toggle and the way home, plus hotkeys, SPA and fullscreen handling |
| `apps/chrome-extension/src/tools/youtube-cinema/cinema.css` | new — the stylesheet, inert without the attribute; only the toggle's own box rules are ungated |
| `apps/chrome-extension/src/common/registry.ts` | register the tool |
| `apps/chrome-extension/src/popup/tool-ui.ts` | the tool's icon (MaximizeScreenIcon) |
| `apps/chrome-extension/extension/manifest.json` | content_scripts entry + `https://www.youtube.com/*` host permission |
| `apps/chrome-extension/scripts/preview-youtube.ts` | new — drives the built tool over real watch pages with a storage stand-in; muted, and not to be run unprompted |
| `apps/chrome-extension/scripts/preview-popup.ts` | the dashboard counts and the openable-tools pattern, now that there are five |
| `apps/chrome-extension/package.json` | build:tools / build:tools:assets / dev:youtube / preview:youtube |
| `package.json` | root alias for preview:youtube |
| `README.md` | tools table, the tool's own section, scripts, verifying, store description, permissions |
| `.agents/todo.md` | the plan for this slice |

## Verification log

**2026-08-23** — `bun run gate` green. `bun run preview:popup` all checks passed.
`bun run preview:youtube` all checks passed on youtube.com: player 1400x813 in a
1400x813 viewport with the video filling it at `object-fit: contain`, masthead /
`#below` / `#secondary` / mini-guide at zero height, control bar 1376px =
viewport − 24, no scroll; the toggle in `.ytp-right-controls-right` immediately
before fullscreen with a real mouse press returning the 929x697 grid player under
a 56px masthead; Shift+F and Escape leaving and returning; `f` giving real
fullscreen with the attribute dropped and the toggle hidden, both restored on
exit; the hotkey setting off letting an F fall through to YouTube; *Every video*
off leaving the page alone with the button still working; the switch clearing both
attribute and button without a reload.

**Two bugs the harness caught before a human could.** The button silently failed
to mount because `insertBefore` was called on `.ytp-right-controls` with the
fullscreen button, which now lives inside `.ytp-right-controls-right`; the
`NotFoundError` was swallowed by the promise the storage reconcile runs in (D8).
Then a worse one: `SVG_NS`, the icon paths and the button's own state were
declared below the boot sequence, so on every load *after the first* — when the
localStorage mirror already says the tool is on — the synchronous boot reached
`createButton()` before those declarations and died on a `ReferenceError`. The
attribute was set first, so the video still filled the window while every
listener after it was never registered: no toggle, no hotkeys, no navigation
handling. Declarations moved above the boot; the harness now asserts a warm-start
boot on its second page, which is the path that used to die.

**Not run after that point.** Everything from the icon redraw (D10) and the way
home (D9) onwards is covered by build + typecheck and by local renders of the
icons at their shipping size — not by `preview:youtube`, which the user asked not
be run against real YouTube (it opens real watch pages, and played their audio out
of the speakers while they were working; it now passes `--mute-audio` regardless).
Its back-button assertions are written but unexecuted. V6 is the check that
matters for those, and it is the user's own eyes.
