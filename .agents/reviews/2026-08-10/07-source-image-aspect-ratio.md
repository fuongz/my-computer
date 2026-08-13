---
status: dropped # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z # the date for this card
priority: medium # low | medium | high
tags: ["chrome-extension", "api", "image-generation"]
---

> **Dropped 2026-08-11.** Never implemented, and the image-generation flow it
> belonged to has been removed from the extension.

# Review: generate at the source image's closest supported ratio

Replicate's current `openai/gpt-image-2` schema has no `width` or `height`
input. It accepts `aspect_ratio`, with `1:1`, `3:2`, `2:3`, or `auto`, and
defaults to `1:1`. The extension will read the source image's natural width and
height and send the closest supported preset, replacing the default square
output. This preserves orientation and approximates the source composition; it
cannot promise the source's exact pixel dimensions.

**How to review:** flip every applicable `- [ ]` to `- [x]`; write `> notes`
under any item you disagree with. For the **pick ONE** group, check exactly one
option. Implementation begins only once every gating box is checked.

## Ratio selection — pick ONE

- [ ] **R1. Nearest preset.** Compare `width / height` with `1:1`, `3:2`, and
      `2:3`, then send the closest one. *(Recommended: preserves the original
      shape as closely as this model allows, including common wide or tall pins.)*
- [ ] **R2. Orientation only.** Send `3:2` for every landscape image, `2:3` for
      every portrait image, and `1:1` only for square images. This is predictable
      but distorts very wide/tall sources more than R1.

- [x] **R3. Let the model choose.** Send `auto` for every source image. This may
      choose a suitable output, but it does not provide a deterministic source
      ratio match.

## Request and UI contract

- [ ] **C1.** Capture the image's natural dimensions when the analysis dialog
      opens and include them only in the extension's internal generate message;
      the Replicate request receives the derived `aspect_ratio`, never unsupported
      `width` or `height` fields.
- [ ] **C2.** Preserve today's `quality: "low"`, one generated image, WebP output,
      polling, error handling, and prompt behavior.
- [ ] **C3.** If dimensions are unavailable or invalid, retain the current `1:1`
      default rather than failing the generation.

## Verification

- [ ] **V1.** Add deterministic coverage for square, landscape, portrait, and
      unavailable-dimension inputs; verify the prediction body uses only a
      supported `aspect_ratio` value.
- [ ] **V2.** Run extension typecheck, production build, and the dialog preview.

## Context

Replicate documents `aspect_ratio` as the size control for
[`openai/gpt-image-2`](https://replicate.com/openai/gpt-image-2/api/schema),
with a default of `1:1`; exact pixel width and height are not exposed by this
model's input schema.

## Out of scope

- Changing image model or provider to one with arbitrary pixel dimensions.
- Resizing/cropping the generated file after Replicate returns it.
- Changing prompt analysis, API-key handling, quality, cost, or generation UI.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.ts` | Carry source dimensions with the generation request. |
| `apps/chrome-extension/src/background/index.ts` | Derive and send the supported Replicate aspect ratio. |
| `apps/chrome-extension/scripts/preview-dialog.ts` | Verify source-ratio behavior. |
