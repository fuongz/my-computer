---
status: done
assignees: ["fuongz"]
created_at: 2026-08-09 00:00:00Z
priority: high
tags: ["chrome-extension", "context-menu", "permissions", "privacy"]
---

# Review: enable Generate Prompt for images on every site

Remove the Pinterest-only restriction: right-clicking any image on any HTTP(S)
website shows the extension's Generate Prompt menu and can open the result
overlay.

**How to review:** flip every `- [ ]` to `- [x]`; add `> notes` below any
item you disagree with. Implementation begins only once all gating boxes are
checked.

## Scope and privacy

- [x] **D1.** Register **Generate Prompt** for all image context-menu targets,
      removing its Pinterest document URL pattern. *(User requested.)*
- [x] **D2.** Expand the prompt-overlay content script to all `http://` and
      `https://` pages. Pinterest theming remains limited to pinterest.com.
- [x] **D3.** Keep the same explicit-action boundary: no image URL leaves the
      browser until the user chooses Generate Prompt, and provider calls still
      use only local API keys in the service worker.
- [x] **D4.** Update manifest and README to disclose the all-site access and
      the fact that the selected image URL may be sent to OpenRouter and, on a
      second click, Replicate.

## Verification

- [x] **D5.** Verify menu visibility and result overlay on Pinterest and one
      non-Pinterest HTTP(S) site, then run typecheck and production build.

## Out of scope

- Running automatically on images, processing local `file:` pages, or adding
  `chrome://`/extension-page access.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/extension/manifest.json` | Broaden content-script/menu scope. |
| `apps/chrome-extension/src/background/index.ts` | Remove Pinterest-only menu restriction. |
| `apps/chrome-extension/src/tools/pinterest-theme/content.ts` | Guard theme-specific code by hostname. |
| `README.md` | Update all-site privacy disclosure. |
