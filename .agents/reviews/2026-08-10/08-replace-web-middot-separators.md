---
status: todo # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z # the date for this card
priority: low # low | medium | high
tags: ["ui", "web"]
---

# Review: replace middot separators across the web app

The web app currently uses `·` as a visual separator in gallery headings and
metadata, usage summaries, account-limit summaries, API-key copy, and a
provider-key badge. Replace each with explicit readable text or an existing
icon, so the meaning does not rely on a decorative character.

**How to review:** flip every applicable `- [ ]` to `- [x]`; write `> notes`
under any item you disagree with. For the **pick ONE** group, check exactly one
option. Implementation begins only once every gating box is checked.

## Replacement style — pick ONE

- [x] **S1. Contextual text.** Use words such as `images`, `requests`, `resets`,
      `ends in`, and `and`; use existing icons only where they clarify a known
      attribute (for example, a calendar/time icon before a timestamp).
      *(Recommended: removes decorative punctuation without introducing ambiguous
      icon-only metadata.)*
- [ ] **S2. Icons for every metadata boundary.** Use small existing Hugeicons
      icons between compact metadata values, retaining text only for prose.

## Scope

- [x] **C1.** Replace both gallery section headings with noun-first counts
      (`Images (N)` and `Prompt generations (N)`).
- [x] **C2.** Make image-card metadata self-describing: a timestamp is introduced
      by a time icon; cost and payment mode use explicit text rather than visual
      separators.
- [x] **C3.** Rewrite Usage and admin summaries with natural-language labels (for
      example, `resets …`, `a record, not a limit`, and `… analyses and … images`).
- [x] **C4.** Rewrite the provider request line and revoked-key notice with text
      that preserves all count and irreversibility information.
- [x] **C5.** Change `Configured ····1234` to `Configured — ending in 1234` (or
      equivalent explicit text), so dots are not used to represent the hidden key.
- [x] **C6.** Do not alter data, actions, page structure, provider/key behavior, or
      responsive layout beyond the space needed for the clearer labels.

## Verification

- [x] **V1.** Confirm `rg '·' apps/web` finds no user-facing middot character.
- [x] **V2.** Run the web app typecheck/build and inspect affected pages at narrow
      and desktop widths.

## Context

The audit found visible middots in `Generations`, `Usage`, `Account limits`,
`API keys`, and `Providers`. This card covers those occurrences, including the
four-dot key suffix because it uses the same character as a mask.

## Out of scope

- Rewriting unrelated copy or changing the app's content model.
- Introducing a new icon set or new shared UI primitives.
- Changing backend APIs, authentication, usage calculations, or key storage.

## Files touched

| File | Change |
| --- | --- |
| `apps/web/src/routes/generations.tsx` | Replace gallery and image-card middots. |
| `apps/web/src/routes/usage.tsx` | Replace usage-summary and provider-line middots. |
| `apps/web/src/routes/admin/users.tsx` | Replace the account-limit separator. |
| `apps/web/src/routes/settings/api-keys.tsx` | Replace the revoked-key separator. |
| `apps/web/src/routes/settings/providers.tsx` | Replace the obscured-key dots. |
