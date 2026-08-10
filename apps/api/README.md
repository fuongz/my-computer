# @fuongz/api

The public generation API. Every client — the Chrome extension today, anything
else later — calls this one URL instead of calling OpenRouter and Replicate
itself.

Hono on Cloudflare Workers, sharing `apps/web`'s D1 database and an R2 bucket.
Keys are minted in the web app and verified here through the same Better Auth
config and schema, which live in `@fuongz/auth` precisely so the two cannot
drift apart.

## Two modes, decided per provider per request

There is no switch for this and nothing stored to say which mode you are in. It
is derived: a credential saved for that provider means **BYOK**, none means
**Default**. So an account with only an OpenRouter key gets BYOK analyses and
free-allowance images, with nothing to configure.

| | Default | BYOK |
| --- | --- | --- |
| Whose key | the deployment's own Worker secret | the caller's, encrypted at rest |
| Metered | yes — a free daily allowance | never |
| Cost recorded | yes | yes |
| Blocked on cost | when the allowance is spent | never |

**The allowance** is 5 analyses and 1 image per account per UTC day, plus a
deployment-wide ceiling for the whole day. The per-account limit bounds one
stranger; sign-up is open, so the ceiling is what bounds the number of
strangers. When the ceiling is spent, Default is refused and BYOK carries on.

### Changing one account's limit

The defaults live in `wrangler.jsonc` and apply to everyone. One account can be
given a different ceiling from the web app's **Account limits** page, from the
admin endpoints below, or with SQL.

**Who may do it** is an allowlist of emails in `ADMIN_EMAILS`, not a role column.
Privilege that lives in deployment config cannot be granted by anything the running
app does — there is no flag for a bug or an injection to write. An empty allowlist
means nobody, so a fresh deployment starts closed, and changing who is an admin is a
deploy.

```jsonc
// apps/api/wrangler.jsonc and apps/web/wrangler.jsonc — keep them identical
"vars": { "ADMIN_EMAILS": "you@example.com,someone@example.com" }
```

| Route | |
| --- | --- |
| `GET /v1/admin/users` | Every account with its effective limits and today's usage. |
| `PUT /v1/admin/users/{id}/allowance` | `{ analysesLimit, imagesLimit, note?, resetToday? }` |
| `DELETE /v1/admin/users/{id}/allowance` | Back to the deployment default. |

They sit behind the same bearer key as everything else, plus the allowlist: a
non-admin with a valid key gets `403`, and no key gets `401`.

Or with SQL, which needs no admin configured at all:

```bash
# Find the account.
bunx wrangler d1 execute DB --remote \
  --command "SELECT id, email FROM user WHERE email = 'them@example.com'"

# Raise analyses to 50, leave images following the deployment default.
bunx wrangler d1 execute DB --remote --command "
  INSERT INTO user_allowance (user_id, analyses_limit, images_limit, note)
  VALUES ('<user id>', 50, NULL, 'trusted user')
  ON CONFLICT (user_id) DO UPDATE SET
    analyses_limit = excluded.analyses_limit,
    images_limit   = excluded.images_limit,
    note           = excluded.note"
```

Each column is independent: **`NULL` means "follow the deployment default"**, so a
raised image limit does not freeze the analysis limit at today's value. **`0` means
zero** — that is how you take the free allowance away from one account without
touching anyone else. Negatives are clamped to `0`.

Deleting the row returns the account to the defaults. `/usage` and `GET /v1/me`
report the effective limit and say whether it came from the default or an override,
so a raised ceiling never looks like a bug in the page. Through the API and the UI a
negative or non-integer limit is a `400` rather than being silently corrected; the
read path still clamps, because a value written straight into the column bypasses
that check.

Two things this does **not** do. It does not raise the deployment-wide ceiling — an
override says how much of the shared pot one account may take, not that the pot is
bigger, so raising someone past `SYSTEM_DAILY_*` will get them
`system_allowance_exhausted` instead. And it does not touch today's counters: to
give somebody a fresh day immediately, delete their `daily_allowance` row for that
`day` as well.

Each counter moves in a single conditional upsert whose `RETURNING` clause is
the answer — SQLite emits a row only if it really inserted or updated, so "no row
back" means "the ceiling refused this". A unit is taken *before* the upstream
call and given back only if the failure was not the caller's own doing; an
upstream rejecting the caller's prompt keeps its unit, or a malformed request
would be an unlimited free retry.

## Endpoints

All under `/v1`, all JSON, all authenticated with `Authorization: Bearer fz_…`
except `/v1/health`. Every failure is `{ "error": { "code", "message" } }` — the
`code` is the part to branch on. An id belonging to another account is a `404`,
never a `403`.

| Route | Purpose |
| --- | --- |
| `GET /v1/health` | Unauthenticated liveness. |
| `GET /v1/me` | Account, per-provider mode, allowance remaining. |
| `POST /v1/analyses` | `{ imageUrl, store? }` → one image prompt. Synchronous. |
| `POST /v1/images` | `{ prompt, quality?, store? }` → `202` and a `processing` generation. |
| `GET /v1/generations` | The caller's history, newest first, cursor-paged. |
| `GET /v1/generations/{id}` | One generation — **and the reconciler**, see below. |
| `GET /v1/generations/{id}/image` | The stored bytes. |
| `DELETE /v1/generations/{id}` | Removes the row and its stored object. |
| `GET /v1/usage` | Allowance state plus the cost ledger. |

`store` defaults to **false**. A service holding other people's images should
retain them because it was asked to, not by omission. Unretained requests still
get a row — the poll needs something to reconcile against and spend has to stay
auditable — but no prompt, no source, and nothing in R2.

## The poll is the reconciler

`POST /v1/images` writes a `processing` row and returns. There is no webhook, no
cron and no background timer: `GET /v1/generations/{id}` asks Replicate where the
prediction got to, and on a terminal answer copies the output into R2, records
the cost and writes the terminal status.

That is what makes a client giving up harmless. The extension polls for a minute
and then shows a timeout **without writing anything** — the row still says
`processing`, and the next view of it (another poll, or the gallery) finishes it.
A UI timeout is not a failed generation.

## Cost

Stored as integer micro-USD, never floats: a ledger that adds 0.011 three hundred
times in binary floating point disagrees with itself. Every row records whether
its figure came from the provider or from a local price table, so correcting the
table never silently rewrites history.

OpenRouter reports its own cost and that number is used. Replicate reports none,
so an image is priced up front from `src/lib/pricing.ts` — **verify those numbers
against the model's page before trusting a total** — and the estimate is cleared
if the prediction turns out not to produce an image.

## Configuration

`wrangler.jsonc` holds the bindings and the allowance ceilings. Secrets are set
with `wrangler secret put` and listed by name in `.env.example`:
`BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` (must match `apps/web` exactly, or
keys minted there will not verify here), `PROVIDER_ENCRYPTION_KEY` (base64 32
bytes, also shared with `apps/web`), and the two `SYSTEM_*` provider keys that
pay for Default mode. Leave a system key unset and that provider is BYOK-only.

`apps/web` owns `migrations/`; this Worker declares no `migrations_dir`. Local
D1 and R2 state is shared with `apps/web` through `.wrangler/state`, which is a
symlink to the repo root.

## Commands

```bash
bun run --cwd apps/api dev        # wrangler dev on :8788
bun run --cwd apps/api test       # both deterministic suites
bun run --cwd apps/api deploy
```

The tests need neither wrangler nor a network: the Hono app is invoked through
`app.fetch` with a SQLite-backed D1 shim, so every SQL statement really runs
while the providers and the bucket are stubbed.
