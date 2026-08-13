---
status: dropped # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z # the date for this card
priority: medium # low | medium | high
tags: ["chrome-extension", "underdraw", "monorepo", "split"]
---

> **Dropped 2026-08-11.** Superseded: rather than move the flow into a second
> extension, it was deleted outright along with `apps/api` and `apps/web`. The
> toolbox keeps only its two tools. Section **F1** here describes the strip-down
> that was actually carried out.

# Review: split image analyze + generate into its own extension — Underdraw

The "How was this made?" flow — context menu, hover trigger, analysis dialog,
image generation — currently ships inside `@fuongz/chrome-extension`, bundled
with the Pinterest theme. It is not a Pinterest feature and never was: it runs
on every http(s) page, imports nothing from the toolbox, and is only co-located
because the manifest declares a single content script.

Move it into a second extension app, **Underdraw**.

**How to review:** flip every applicable `- [ ]` to `- [x]`; write `> notes`
under any item you disagree with. For each **pick ONE** group, check exactly one
option. Implementation begins only once every gating box is checked.

## The name

`Underdraw` — in painting, the *underdrawing* is the preparatory sketch buried
beneath the finished surface, revealed only under infrared. That is what the
extension does: show the layer under a finished image, then let you draw your
own over it.

Verified unused before choosing (2026-08-10): no npm package, no GitHub repo, no
PyPI package, no Chrome or Firefox extension, no product in search results;
`underdraw.app` and `underdraw.dev` unregistered, `underdraw.com` parked with no
product on it. Rejected because they are already taken by a live product:
Reprompt, PromptLens (an identical right-click-image-to-prompt extension),
UnPrompt, Sourcery, Pentimento, Ekphrasis, Prompture, Promptum, Sfumato,
Obskura, Promptrace.

- [ ] **N1.** The name is `Underdraw`; the app is `@fuongz/underdraw` at
      `apps/underdraw/`, loaded unpacked from `apps/underdraw/extension/`.

## A. What moves vs. what is copied — pick ONE

- [ ] **A1. Move, do not share.** Every file below leaves `chrome-extension`
      and lands in `underdraw`; nothing is left behind and no new workspace
      package appears. Nothing the toolbox keeps imports any of it, so after the
      move the two apps share zero TypeScript.
      *(Recommended: `api-client.ts`, `connection.ts`, `legacy-keys.ts`, the
      background worker, and the whole options page exist solely for this
      feature — the toolbox has no API surface left once they go. A shared
      package would have exactly one consumer.)*
- [ ] **A2. Extract `packages/extension-kit`.** Put `api-client.ts`,
      `connection.ts`, `icons.ts`, `ui.ts`, and the Tailwind entry into a shared
      workspace package that both extensions depend on.
      *(Costs a package plus build wiring for two consumers, and buys sharing
      only for files the toolbox would no longer use.)*

## B. Underdraw's options-page stylesheet — pick ONE

The options page is the only surface that needs the design system; the analysis
dialog carries its own CSS and imports nothing.

- [ ] **B1. Copy `popup/style.css` and the Tailwind build step.** Underdraw gets
      its own `src/options/style.css`, its own `tailwindcss` dev dependency, and
      its own bundled `Geist-Variable.woff2`.
      *(Recommended: each extension stays independently buildable and
      shippable. Accepts that the two token files can drift.)*
- [ ] **B2. Share the stylesheet via the package from A2.** Only coherent if A2
      is chosen.
- [ ] **B3. Hand-write plain CSS for the options page.** Drops Tailwind from
      Underdraw entirely, at the cost of rewriting every class in
      `options/index.html`.

## C. Appearance in Underdraw — pick ONE

- [ ] **C1. Follow the system only.** No appearance control, no
      `appearance.ts`, no `theme.ts`. The copied stylesheet keeps its bare
      `:root` light palette and `prefers-color-scheme` dark block; nothing
      stamps `data-theme`.
      *(Recommended: `analysis-dialog.css` already themes on
      `prefers-color-scheme` alone and never read the toolbox's setting, so this
      makes the whole extension consistent instead of half-and-half.)*
- [ ] **C2. Give Underdraw its own Dark/Light/System control.** Copy
      `appearance.ts` + `theme.ts` under a new storage key and add the control
      to the options page.

## D. Underdraw's toolbar action — pick ONE

- [ ] **D1. No popup — the icon opens Settings.** `action` with no
      `default_popup`, and `chrome.action.onClicked` calls
      `chrome.runtime.openOptionsPage()`.
      *(Recommended: the extension's only UI is the in-page dialog; a popup
      would have one link in it.)*
- [ ] **D2. A small status popup.** Shows connection state, today's remaining
      allowance, and a link to Settings.

## E. Message-type prefix — pick ONE

Runtime messaging is per-extension, so `fz:` cannot collide with the toolbox
even with both installed. This is cosmetic.

- [ ] **E1. Rename `fz:` → `ud:`.** `fz:prompt-dialog` → `ud:prompt-dialog`,
      and so on across `analysis-dialog.ts` and `background/index.ts`.
      *(Recommended: matches the new app's identity. Makes the diff a
      move-plus-rename rather than a pure move.)*
- [ ] **E2. Keep `fz:`.** The move stays a byte-for-byte file relocation, which
      is easier to review.

## F. What the toolbox extension loses — pick ONE

- [ ] **F1. Strip it down.** Delete `src/background/`, `src/options/`,
      `src/common/{api-client,connection,legacy-keys}.ts`, the Settings button
      in `src/popup/index.ts:85-87`, the `options_page` and `background` manifest
      keys, the `contextMenus` and `scripting` permissions, and
      `optional_host_permissions`. Narrow the content script from
      `http://*/*, https://*/*` to `https://*.pinterest.com/*`.
      *(Recommended: with the connection gone the options page is empty, and the
      appearance control already lives in the popup app bar. Narrowing the match
      pattern is the real prize — the toolbox stops injecting into every page on
      the web.)*
- [ ] **F2. Keep an options page** in the toolbox for some future setting.

## Scope

- [ ] **S1.** Create `apps/underdraw/` with its own `package.json`
      (`@fuongz/underdraw`), `tsconfig.json` copied from the toolbox's, and
      `extension/manifest.json`.
- [ ] **S2.** Move `analysis-dialog.ts` and `analysis-dialog.css` to
      `apps/underdraw/src/content/`. The `.ts` file has zero imports, so it moves
      unchanged apart from the E-group rename.
- [ ] **S3.** Move `src/background/index.ts`, `src/common/api-client.ts`,
      `src/common/connection.ts`, `src/common/legacy-keys.ts`, and all of
      `src/options/` into Underdraw. Drop the `../popup/theme` and
      `../common/appearance` imports from `options/index.ts` per C1.
- [ ] **S4.** Move `scripts/{preview-dialog,test-prompt-flow,test-connection}.ts`
      and `.preview/dialog-*.png` to Underdraw. `preview-theme.ts` and
      `preview-popup.ts` stay with the toolbox; `make-icons.ts` is copied so each
      app can rasterize its own mark.
- [ ] **S5.** Underdraw's manifest: `storage`, `contextMenus`, `scripting`
      permissions; no static `host_permissions`;
      `optional_host_permissions` of `https://*/*`, `http://localhost/*`,
      `http://127.0.0.1/*` for the configured API base URL; content script on
      `http://*/*, https://*/*`.
- [ ] **S6. Content script timing — `document_idle`, not `document_start`.**
      The theme needed `document_start` to beat first paint; the dialog only
      mounts a hover trigger and a message listener, so it does not.
- [ ] **S7.** Give Underdraw its own `assets/icon.svg` and generated PNGs, so
      the two extensions are distinguishable in the Chrome toolbar.
- [ ] **S8.** Wire root `package.json`: `dev:underdraw`, and repoint
      `test:connection`, `test:prompt-flow`, and `preview:dialog` at
      `@fuongz/underdraw`. `bun run build` picks the app up from `apps/*`
      automatically.
- [ ] **S9.** Update `README.md` (workspace layout, install steps for two
      unpacked extensions, the tools table, the script table) and
      `docs/design-system.md` (paths, and whether its scope now covers two
      apps).
- [ ] **S10. Do not change any behavior of the flow itself** — states,
      messages, API calls, polling, drag/minimize, storage shapes. This card is
      a relocation, not a redesign.

## Migration cost to call out

- [ ] **M1.** `chrome.storage` is per-extension, so **the saved API base URL and
      key do not carry over**. After installing Underdraw the user must paste the
      key again in its Settings. There is no automatic path; confirm this is
      acceptable rather than worked around.
- [ ] **M2.** Storage keys keep their current names (`fz.connection.v1`,
      `fz.api-keys.v1`) inside Underdraw. Isolated namespaces mean there is
      nothing to disambiguate, and keeping them makes the moved code diff clean.
- [ ] **M3.** The old provider keys under `fz.api-keys.v1` remain in the
      *toolbox's* storage, where nothing will read or offer to clear them once
      `legacy-keys.ts` moves. Decide: leave them (silent, matches the existing
      "not ours to delete" stance) or clear them in the toolbox before stripping
      the options page.

## Verification

- [ ] **V1.** `bun run gate` (build + lint + typecheck) passes for the whole
      workspace, including the new app.
- [ ] **V2.** `bun run test:connection` and `bun run test:prompt-flow` pass from
      their new home.
- [ ] **V3.** `bun run preview:dialog` reproduces all five dialog states as
      screenshots from the new app.
- [ ] **V4.** Both extensions loaded unpacked at once: right-click an image on a
      non-Pinterest page → Underdraw's dialog opens, analyzes, generates. The
      toolbox contributes no context menu and injects nothing on that page.
- [ ] **V5.** On pinterest.com the theme still applies with no white flash, and
      still survives SPA navigation.
- [ ] **V6.** Confirm the toolbox no longer requests `contextMenus` or
      `scripting` on its Chrome extension details page.

## Context

`analysis-dialog.ts` is 1323 lines with **zero import statements** and
`analysis-dialog.css` is 1321 lines themed purely on `prefers-color-scheme`.
Together they talk to the rest of the extension only through
`chrome.runtime.sendMessage`. The background worker is 160 lines and every one
of them serves this flow. That is why this split is close to a file move rather
than a refactor.

The header comment in `pinterest-theme/content.ts` already says the two ship
together only because the manifest declares one content script — this card is
that comment being acted on.

## Out of scope

- Any change to `apps/api` or `apps/web`, including endpoints, auth, allowances,
  and the Generations gallery.
- Redesigning the dialog, the options page, or the generation flow.
- Publishing either extension to the Chrome Web Store, or registering a domain.
- Touching the T1 Esports Tracker.
- Migrating the API key between extensions automatically (see M1).

## Files touched

| File | Change |
| --- | --- |
| `apps/underdraw/package.json` | New: `@fuongz/underdraw`, build/dev/test/preview scripts. |
| `apps/underdraw/tsconfig.json` | New: copy of the toolbox's. |
| `apps/underdraw/extension/manifest.json` | New: content script, worker, options page, permissions per S5. |
| `apps/underdraw/src/content/analysis-dialog.{ts,css}` | Moved from `chrome-extension/src/tools/pinterest-theme/`. |
| `apps/underdraw/src/content/index.ts` | New entry: `listenForAnalysisMessages()` + `mountQuickTrigger()`. |
| `apps/underdraw/src/background/index.ts` | Moved. |
| `apps/underdraw/src/common/{api-client,connection,legacy-keys}.ts` | Moved. |
| `apps/underdraw/src/options/*` | Moved; appearance imports dropped per C1. |
| `apps/underdraw/scripts/*` | `preview-dialog`, `test-prompt-flow`, `test-connection` moved; `make-icons` copied. |
| `apps/underdraw/assets/icon.svg` | New mark. |
| `apps/chrome-extension/extension/manifest.json` | Drop worker, options page, `contextMenus`/`scripting`, optional hosts; narrow content script to Pinterest. |
| `apps/chrome-extension/src/tools/pinterest-theme/content.ts` | Drop the two `analysis-dialog` calls and the header note about co-shipping. |
| `apps/chrome-extension/src/popup/index.ts` | Remove the Settings button (lines 85-87). |
| `apps/chrome-extension/package.json` | Drop moved build steps and now-unused deps. |
| `README.md` | Two apps, two unpacked installs, updated tables. |
| `docs/design-system.md` | Updated paths and scope. |
