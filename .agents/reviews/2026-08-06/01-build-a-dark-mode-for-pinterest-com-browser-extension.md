---
status: done
assignees: []
created_at: 2026-08-06 00:00:00Z
priority: medium
tags: ["extension", "dark-mode", "pinterest"]
---

# Review: Build a Dark mode for pinterest.com browser extension

Clone the structure of the `x-extensions` project at /Users/pp/fuongz_projects/on-init/x-extensions into fuongz-browser-ext, but strip it down to a single-purpose extension that applies a dark theme to pinterest.com. Scope is one content-script CSS override plus a minimal on/off toggle — no other site support.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Decisions

- [x] **D1.** Read the x-extensions repo and confirm which parts of its scaffold (build tooling, manifest, folder layout) to keep versus drop.
- [x] **D2.** Use Manifest V3 with host permissions scoped to *.pinterest.com only.
- [x] **D3.** Inject the dark theme via a content script that applies a CSS file at document_start to avoid a white flash.
- [x] **D4.** Write the dark palette as CSS custom properties overriding Pinterest's own variables, with targeted overrides for the header, pin grid, and modals.
- [x] **D5.** Add a browser action popup with a single on/off toggle, persisting the state in chrome.storage.sync.
- [x] **D6.** Handle Pinterest's SPA navigation so the theme survives client-side route changes.
- [x] **D7.** Verify the result on the home feed, a board page, a pin detail modal, and search results.
  > Partially verified. `bun run preview` drives real pinterest.com over CDP and asserts the theme on search results, the signed-out home page, and a topic page — all passing, screenshots in `.preview/`. The logged-in home feed, a board page, and the pin closeup modal need a signed-in human: Chrome 137 disabled `--load-extension`, so no headless run can sign in. Left as a manual check in the README's Verifying section.
- [x] **D8.** Add a short README with load-unpacked instructions and skip store publishing for now.
