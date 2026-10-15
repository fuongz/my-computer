---
name: test-strategy
description: Pick the right test level, cover the scenarios that matter, and write the failing-first test for a bug.
---

# Test strategy

Use when adding tests or judging coverage.

## Choose the level (lowest that captures the behavior)
- Pure logic, no I/O → unit test.
- Crosses a boundary (db, network, fs) → integration test.
- Critical end-to-end user flow → e2e test (sparingly).

## Cover the scenarios
For each unit: happy path, empty/null, boundary values (min/max/zero/negative),
error paths (invalid input, timeout, failure), and concurrency where relevant.

## Rules
- Test behavior, not implementation; one concept per test.
- Mock at system boundaries, not between internal functions.
- Tests are independent — no shared mutable state.
- Each test name reads like a specification.

## Prove-it (for a bug)
1. Write a test that reproduces the bug — it must FAIL on current code.
2. Confirm it fails, then implement the fix.
3. The same test now passes and guards against regression.
