---
status: done # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z # the date for this card
priority: medium # low | medium | high
tags: ["chrome-extension", "ui", "drag-and-drop", "accessibility"]
---

# Review: move the image-analysis dialog by dragging

The floating **How was this made?** dialog can be moved to another area of the
current viewport. Its opening location remains the existing top-right position.
The confirmation state keeps only its primary action; its descriptive hint card
was removed at the user's direction.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` under any
item you disagree with. Implementation begins only once every gating box is
checked.

## Drag interaction

- [x] **D1.** Add a visible, labelled drag handle to the dialog header area.
      Dragging it with mouse, trackpad, or touch repositions the dialog.
- [x] **D2.** Do not start a drag from buttons, links, text selection, image,
      or scrollable prompt content. Existing click, copy, scroll, and close
      behavior remains unchanged. *(Recommended: handle-only dragging.)*
- [x] **D3.** Store the moved position in the dialog instance while it is open;
      reopening the dialog starts at the existing top-right default. *(Recommended:
      avoid a cross-site, persisted position.)*

## Positioning and accessibility

- [x] **D4.** Clamp movement so the dialog remains reachable in the visible
      viewport, including after browser-window resize.
- [x] **D5.** Use Pointer Events, prevent accidental text selection during an
      active drag, and expose the handle's purpose to assistive technology.

## Verification

- [x] **D6.** Add or update deterministic coverage for drag positioning and
      boundary clamping, then run the extension typecheck and production build.

## Out of scope

- Persisting the position across pages or browser sessions; resizing, docking,
  snapping, or adding keyboard-based positioning controls; changing dialog
  content or the analysis/generation protocol.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.ts` | Add drag lifecycle and viewport-bound position management. |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.css` | Style the drag handle and active-drag state. |
| `apps/chrome-extension/scripts/*` | Add deterministic interaction coverage if the existing script harness supports it. |
