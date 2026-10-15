---
name: code-review-rubric
description: Review a change across correctness, readability, architecture, security and performance with severity tags.
---

# Code review rubric

Use when reviewing a diff. Read the tests and the task/spec first, then the diff
in context.

## Five dimensions
1. **Correctness** — spec met? edge cases (null/empty/boundary), error paths, races?
2. **Readability** — clear names, shallow control flow, related code grouped.
3. **Architecture** — fits existing patterns; right abstraction; dependency direction.
4. **Security** — input validated at boundaries, authz checked, secrets out of code, queries parameterized.
5. **Performance** — no N+1, no unbounded fetch, no needless re-renders, list pagination.

## Output
Categorize every finding:
- **Critical** — block the merge (security hole, data loss, broken behavior).
- **Important** — should fix (missing test, wrong abstraction, poor error handling).
- **Suggestion** — optional improvement (naming, style).

Give each finding a `file:line` and a concrete fix. Always name at least one thing
done well. Don't approve while a Critical remains. If uncertain, say so.
