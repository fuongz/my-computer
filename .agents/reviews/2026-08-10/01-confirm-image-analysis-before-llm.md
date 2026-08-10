---
status: done
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z
priority: high
tags: ["chrome-extension", "context-menu", "openrouter", "ui", "privacy"]
---

# Review: confirm image analysis before sending it to the LLM

Right-clicking an image will open a compact dialog before any provider request.
The dialog is styled after the supplied reference and calls the action **How was
this made?**; the LLM request begins only when the user explicitly selects
**Analyze image**.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` under any
item you disagree with. Implementation begins only once every gating box is
checked.

## Confirmation and privacy

- [x] **D1.** Rename the image context-menu action from **Generate Prompt** to
      **How was this made?**. Selecting it opens the confirmation dialog but
      does not call OpenRouter. *(Recommended: grammatical and clear.)*
- [x] **D2.** The confirmation dialog includes the selected image preview,
      close control, concise explanation, and an explicit **Analyze image**
      button. It follows the rounded floating-card layout in the supplied
      reference.
- [x] **D3.** Only **Analyze image** sends the selected image URL to the
      service worker and starts the existing OpenRouter request. Closing the
      dialog or clicking elsewhere sends no request.
- [x] **D4.** Preserve existing loading, result, copy-prompt, image-generation,
      missing-key, and error states after confirmation.

## Copy and scope

- [x] **D5.** Use the dialog title **How was this made?** and the primary
      action **Analyze image**. Do not add a free-form chat or save a history.
- [x] **D6.** Keep this flow available on all existing HTTP(S) image targets;
      do not alter permissions, host scope, provider, model, or request prompt.

## Verification

- [x] **D7.** Add or update deterministic coverage proving the context-menu
      click alone does not call the LLM and **Analyze image** does; then run
      typecheck and production build.

## Out of scope

- Editing the generated prompt before analysis, processing images automatically,
  uploading image bytes, adding conversation history, or changing image
  generation.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/background/index.ts` | Split opening the dialog from starting LLM analysis. |
| `apps/chrome-extension/src/tools/pinterest-theme/content.ts` | Render and operate the confirmation dialog. |
| `apps/chrome-extension/src/tools/pinterest-theme/theme.css` | Style the new dialog. |
| `apps/chrome-extension/scripts/*` | Update deterministic behavior and UI coverage. |
