---
status: done
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z
priority: high
tags: ["webapp", "assets", "tooling"]
---

# Review: generated-assets web app foundation

Create a new web application in this monorepo as the durable home for images
generated from **How was this made?**, with an architecture that can grow to
host additional tools.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` under any
item you disagree with. For the app-name section, check exactly one option.
Implementation begins only once every gating box is checked.

## App identity — pick ONE

- [ ] **A1.** Create `apps/tool-hub/` with package `@fuongz/tool-hub`.
      *(Recommended: describes an expandable home for generated assets and future tools.)*
- [x] **A2.** Create `apps/web/` with package `@fuongz/web`.
- [ ] **A3.** Use another lowercase kebab-case app name, noted below.

## Foundation

- [x] **F1.** Use the standard TanStack Start + Tailwind v4 + shadcn/Base UI
      scaffold, as one app inside the existing bun-workspace monorepo.
- [x] **F2.** Add the standard layout audit configuration and scripts needed to
      keep the new app's route, component, hook, server, and library boundaries
      explicit from its first commit.
- [x] **F3.** The initial app is only a runnable foundation/landing route; do
      not invent storage, authentication, or a database before their concrete
      requirements are known.

## Integration boundary

- [x] **I1.** Do not change the existing Chrome extension's behavior yet. A
      later, separately reviewed slice will define how generated images flow
      from **How was this made?** into this web app.

## Verification

- [x] **V1.** Install dependencies, then run the required gate in order:
      build, lint/layout audit, and typecheck; start the new app and confirm
      its landing route loads locally.

## Context

The Chrome extension already exposes **How was this made?**. This new web app
will become a central place to retain the images it generates, while leaving
room for future tools without prematurely selecting a backend or data model.

## Out of scope

Persisting generated images, authentication, accounts, cloud deployment,
database/storage selection, migration of extension UI, and any integration API.

## Files touched

| File | Change |
| --- | --- |
| `.agents/todo.md` | Record the scoped scaffold and verification plan. |
| `.agents/reviews/2026-08-10/02-generated-assets-webapp.md` | Review gate for the app identity and foundation. |
| `apps/<approved-name>/**` | New web app scaffold after approval. |
| `layout.audit.json`, `scripts/audit-layout.mjs`, root workspace configuration | Add only the standard layout-gate wiring required by the scaffold. |
