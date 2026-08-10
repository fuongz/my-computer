---
status: done
assignees: ["fuongz"]
created_at: 2026-08-09 00:00:00Z
priority: high
tags: ["chrome-extension", "pinterest", "replicate", "image-generation", "security"]
---

# Review: generate an image from the Pinterest prompt

After OpenRouter returns a copyable prompt, add a nearby **Generate image**
button. On explicit click, use the locally stored Replicate key to generate a
low-quality `gpt-image-2` image and show it in the existing overlay.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` below any
item you disagree with. Implementation begins only once all gating boxes are
checked.

## Context

This is a billable provider action. The page must never receive the Replicate
key; the MV3 service worker already owns provider calls and will manage this
new prediction lifecycle too.

## Provider and privacy

- [x] **D1.** Use Replicate only after the user presses **Generate image**;
      never generate automatically when a prompt arrives. *(Recommended.)*
- [x] **D2.** Read the Replicate API key only in the service worker from
      `chrome.storage.local`. If missing, show an in-overlay Settings action
      and make no provider request.
- [x] **D3.** Use Replicate's current `gpt-image-2` model contract with its
      low-quality option. Verify current parameter names in official docs
      before implementation. *(Recommended.)*
- [x] **D4.** Keep the generated image, prompt, and provider response only in
      memory for the current overlay; do not persist them in Chrome storage.

## Result UI

- [x] **D5.** Place **Generate image** beside **Copy prompt** after a prompt is
      ready. It changes to a disabled running state while the prediction runs.
- [x] **D6.** Show the completed image inside the overlay with an explicit
      open/download link; show a concise safe error on failure or timeout.
- [x] **D7.** Allow closing the overlay while generation continues, but do not
      auto-reopen or save the result. *(Recommended.)*

## Verification

- [x] **D8.** Add deterministic tests for missing key, exact model/low-quality
      request, polling success, failure, timeout, button state, and safe error
      rendering. Use only stubs.
- [x] **D9.** Run typecheck, production build, current prompt checks, and a
      manual Pinterest test with a configured Replicate key.

## Out of scope

- Image editing, multiple variants, saved history/gallery, automatic retries,
  background notifications, or charging/budget controls.
- Changing OpenRouter prompt generation or exposing either key to page code.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/extension/manifest.json` | Replicate host permission if required. |
| `apps/chrome-extension/src/background/*` | Replicate prediction/polling and messages. |
| `apps/chrome-extension/src/tools/pinterest-theme/content.ts` | Generate button and image preview UI. |
| `apps/chrome-extension/src/tools/pinterest-theme/theme.css` | Image result and running-state styles. |
| `apps/chrome-extension/src/common/api-keys.ts` | Existing local key accessor reuse. |
| `apps/chrome-extension/scripts/*` | Deterministic coverage. |
| `README.md` | Provider, privacy, and user-action documentation. |
