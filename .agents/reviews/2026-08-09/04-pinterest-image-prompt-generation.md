---
status: done
assignees: ["fuongz"]
created_at: 2026-08-09 00:00:00Z
priority: high
tags: ["chrome-extension", "pinterest", "openrouter", "ai", "security"]
---

# Review: generate a similar-image prompt from Pinterest

When the user right-clicks an image on pinterest.com, add **Generate Prompt**
to the extension context menu. It sends that image to OpenRouter with
`openai/gpt-5.6-luna`, then shows a copyable prompt suitable for `gpt-image-2`.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` below any
item you disagree with. Implementation begins only once all gating boxes are
checked.

## Context

The OpenRouter API key from the Options page is stored only in
`chrome.storage.local`. A content script cannot safely own provider calls, so
an MV3 service worker will own the credential read and network request; the
Pinterest page only provides the selected image and displays the result.

## Privacy, permissions, and request

- [x] **D1.** Add Chrome's `contextMenus` permission and an MV3 service worker.
      Register one item, **Generate Prompt**, visible only for images on
      pinterest.com. *(Recommended.)*
- [x] **D2.** Send the selected image to OpenRouter only after that explicit
      context-menu click. Do not upload images automatically, retain them, or
      send the Replicate key anywhere.
- [x] **D3.** Read the OpenRouter key solely in the service worker from the
      existing local-only settings record. If absent, do not call the network;
      show a message linking the user to Settings.
- [x] **D4.** Use the current official OpenRouter multimodal request format
      with model `openai/gpt-5.6-luna`, instructing it to return only one
      detailed, `gpt-image-2`-ready image prompt. The user has explicitly
      selected this model.
- [x] **D5. pick ONE** — image input strategy:
  - [x] **D5a.** Resolve the clicked image URL in the worker and provide that
        URL as the multimodal image input. If Pinterest blocks the fetch or the
        URL is unsuitable, show an actionable error. *(Recommended: avoids
        injecting/copying image bytes into the page.)*
  - [ ] **D5b.** Fetch and base64-encode the selected image before sending it.
        More resilient to model-provider URL access, but processes and sends a
        larger payload through the extension.

## Result UI

- [x] **D6.** Show a focused, dismissible Pinterest-page overlay immediately:
      loading state first, then a readable textarea containing the generated
      prompt plus a **Copy prompt** action. Textarea selection and normal
      keyboard copy both work. *(Recommended.)*
- [x] **D7.** The overlay reports request/image/provider errors without
      exposing the API key, raw request headers, or full provider error body.
- [x] **D8.** Keep Pinterest's existing theme tool and normal image context
      menu behavior intact. The menu item is additive; no prompt is generated
      until selected.

## Verification

- [x] **D9.** Add deterministic tests for: context-menu scope, no-key path,
      exact selected model/request construction, success result, copy behavior,
      and safe error rendering. Stub all image and OpenRouter responses.
- [x] **D10.** Run typecheck, production build, and the existing popup/theme
      checks; manually test one real Pinterest image and verify the prompt can
      be copied.

## Out of scope

- Generating an image, submitting anything to `gpt-image-2`, or adding image
  generation controls.
- Saving prompts or source images, batch processing, keyboard shortcuts, and
  processing non-Pinterest images.
- Sharing keys across Chrome profiles or exposing keys to the content script.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/extension/manifest.json` | `contextMenus`, service worker, OpenRouter host permission. |
| `apps/chrome-extension/src/background/*` | Context-menu registration, local-key read, OpenRouter call, messages. |
| `apps/chrome-extension/src/tools/pinterest-theme/content.ts` | Receive generation state/result and render the overlay. |
| `apps/chrome-extension/src/tools/pinterest-theme/*` | Overlay styles and image-selection helpers. |
| `apps/chrome-extension/src/common/api-keys.ts` | Internal key accessor for the worker, if needed. |
| `apps/chrome-extension/package.json` | Bundle the service worker and any test tooling. |
| `apps/chrome-extension/scripts/*` | Deterministic tests and preview coverage. |
| `README.md` | Permissions, privacy, setup, and feature documentation. |
