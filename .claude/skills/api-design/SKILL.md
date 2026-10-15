---
name: api-design
description: Design consistent, versioned HTTP/JSON APIs — resources, status codes, errors, pagination, idempotency.
---

# API design

Use when adding or changing an HTTP endpoint. Keep the surface consistent and
hard to misuse.

## Resources & methods
- Nouns, not verbs, in paths; plural collections (`/orders`, `/orders/{id}`).
- GET is safe + idempotent; PUT/DELETE idempotent; POST creates. Never mutate on GET.

## Responses
- Correct status: 200/201/204, 400/401/403/404/409/422, 429, 5xx. Don't 200-with-error-body.
- One error shape everywhere: `{ error: { code, message, details? } }`. Stable machine `code`.
- Validate input at the boundary; reject unknown fields or ignore them consistently.

## Scale & safety
- Paginate every list (cursor preferred); never return unbounded sets.
- Idempotency keys for unsafe retryable POSTs; rate-limit and return `Retry-After`.
- Version breaking changes (path or header); additive changes stay backward-compatible.
- Never leak internals (stack traces, SQL) in errors; log the detail server-side.
