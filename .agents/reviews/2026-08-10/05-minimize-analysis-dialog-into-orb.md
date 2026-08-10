---
status: done # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z # the date for this card
priority: medium # low | medium | high
tags: ["chrome-extension", "ui", "drag-and-drop", "animation", "accessibility"]
---

# Review: minimize the analysis dialog into a draggable orb

The dialog’s current close control becomes **Minimize**. Minimizing transforms
the dialog into a small orb at its current position instead of discarding the
active analysis, prompt, or generated-image state.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` under any
item you disagree with. Implementation begins only once every gating box is
checked.

## Minimize and restore

- [x] **D1.** Replace the visible close control with a labelled **Minimize**
      control. Minimizing animates the dialog into an orb at its current
      viewport position.
- [x] **D2.** Clicking the orb restores the complete dialog and its exact prior
      state (confirm, loading, prompt, generating, generated, or error).
- [x] **D3.** The orb retains the current in-session position; both the dialog
      and orb remain clamped inside the viewport on drag and resize.

## Orb controls

- [x] **D4.** The orb itself can be dragged without restoring it. A normal click
      (without dragging) restores the dialog. *(Recommended: use a small drag
      threshold so pointer jitter does not turn a click into a drag.)*
- [x] **D5.** Hovering or keyboard focusing the orb reveals a dedicated close
      button. That button closes and destroys the flow; it does not restore the
      dialog first.
- [x] **D6.** Provide clear accessible names for minimize, restore, and close;
      retain Escape-to-close when the full dialog is open.

## Verification

- [x] **D7.** Extend the deterministic dialog preview to cover minimize,
      restore-state continuity, orb dragging, hover/focus close, viewport
      clamping, and final close; run typecheck and the production build.

## Out of scope

- Persisting an orb across page loads or tabs; changing provider requests;
  changing the dialog’s current content states; adding docking, snapping, or a
  minimized-state history.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.ts` | Model minimized state, orb interaction, and state-preserving restoration. |
| `apps/chrome-extension/src/tools/pinterest-theme/analysis-dialog.css` | Add dialog-to-orb motion and the hover/focus close affordance. |
| `apps/chrome-extension/scripts/preview-dialog.ts` | Add deterministic minimize/orb interaction coverage. |
