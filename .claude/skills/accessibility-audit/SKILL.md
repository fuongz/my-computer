---
name: accessibility-audit
description: Audit a UI change for WCAG 2.2 AA: semantics, keyboard, contrast, focus, and reduced-motion.
---

# Accessibility audit (WCAG 2.2 AA)

Use when reviewing or building UI. Walk the change against this checklist and
report failures with the element and the fix.

## Structure & semantics
- Landmarks (`header`/`nav`/`main`/`footer`) and one `h1`; headings don't skip levels.
- Native elements over ARIA (`button`, `a[href]`, `label`); ARIA only to fill gaps.
- Every control has an accessible name (visible label, `aria-label`, or `aria-labelledby`).

## Keyboard & focus
- Every interactive element is reachable and operable by keyboard, in a logical order.
- Visible focus indicator (never `outline: none` without a replacement).
- No keyboard traps; modals trap focus while open and restore it on close.

## Perceivable
- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI/graphical boundaries).
- Information is never conveyed by color alone.
- Images have `alt`; decorative images use `alt=""`.

## Motion & responsive
- Honor `prefers-reduced-motion`; no essential info in motion alone.
- Content reflows to 320px width without horizontal scroll; targets ≥ 24×24px.

Report each finding as: element/selector → which criterion → concrete fix.
