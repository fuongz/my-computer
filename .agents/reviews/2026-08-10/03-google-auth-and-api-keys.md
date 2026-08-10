---
status: processing
assignees: ["fuongz"]
created_at: 2026-08-10 00:00:00Z
priority: high
tags: ["webapp", "auth", "api-key", "security"]
---

# Review: GitHub-only access and personal API keys

Add Better Auth to `apps/web`: a GitHub-only sign-in, authenticated routes, and
a screen where a signed-in user can create and revoke their own API keys.

**How to review:** flip every applicable `- [ ]` to `- [x]`; write `> notes`
under any item you disagree with. For each **pick ONE** group, select exactly
one option. Implementation begins only once every gating box is checked.

## Persistence/runtime — pick ONE

- [x] **P1.** Use Cloudflare D1 + Drizzle. *(Recommended: durable production
      database and aligns with the web-stack standard; deployment config and
      migrations will be included.)*
- [ ] **P2.** Use a PostgreSQL-compatible database + Drizzle; record the
      connection environment variable name below.
- [ ] **P3.** Use another database/runtime, documented below.

## GitHub access policy — pick ONE

- [x] **G1.** Permit any GitHub account to create an account and sign in.
      *(Recommended for a public app.)*
- [ ] **G2.** Restrict access to explicitly configured GitHub email addresses;
      record the allowlist below. *(Recommended for a private personal app.)*

## Authentication

- [x] **A1.** Install and configure Better Auth with GitHub as the only login
      method; no password, email, guest, or other social-provider sign-in.
- [x] **A2.** Mount Better Auth's `/api/auth/*` handler, configure trusted
      origins, and keep `BETTER_AUTH_SECRET`, GitHub client ID, and GitHub client
      secret in untracked environment files only.
- [x] **A3.** Create a `/login` page with a GitHub sign-in action and clear
      configuration/error states. Authenticated visitors to `/login` redirect to
      the app home.
- [x] **A4.** Make all present and future product routes private by default:
      unauthenticated visitors redirect to `/login`; the auth handler and login
      route remain public.

## API keys

- [x] **K1.** Enable Better Auth's official `@better-auth/api-key` plugin with
      database-backed, user-owned, hashed keys. Do not enable session impersonation
      by API key in this slice.
- [x] **K2.** Add an authenticated `/settings/api-keys` page that lists a user's
      keys, creates a named key, shows the raw secret exactly once on creation,
      and revokes keys. Never render the raw secret again.
- [x] **K3.** Use a recognisable `fz_` key prefix and require a key name. No
      permissions, rate limits, expiry controls, organization keys, or external
      API endpoints yet.

## Verification

- [x] **V1.** Generate and apply the Better Auth/Drizzle schema migration for
      the chosen database; add a checked-in environment-example file with names
      only, never values.
- [x] **V2.** Verify route protection and API-key management using deterministic
      tests or a local authenticated walkthrough, then run `bun run gate`.

## Context

The new web app will store generated assets and host future tools. GitHub is the
first supported identity provider. API keys are for a user's future programmatic
access, not for logging into the browser app.

## Out of scope

Asset storage, API endpoints consuming keys, organization/team keys, user roles,
email/password login, additional OAuth providers, billing, deployment, and a
GitHub OAuth App setup performed on the user's behalf.

## Files touched

| File | Change |
| --- | --- |
| `apps/web/src/server/auth.ts` and `apps/web/src/lib/auth-client.ts` | Better Auth server/client configuration. |
| `apps/web/src/routes/api/auth/$.ts`, `apps/web/src/routes/login.tsx`, protected routes | Auth handler, login screen, and route guards. |
| `apps/web/src/components/features/auth/**`, `apps/web/src/components/features/api-keys/**` | Private auth and key-management UI. |
| `apps/web/src/server/**`, migrations, database config | Chosen database adapter and schema. |
| `apps/web/package.json`, `.env.example`, configuration files | Dependencies and environment-variable contract. |
