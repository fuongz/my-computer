/**
 * The allowance period is the UTC calendar day.
 *
 * Chosen over a rolling window because a user can be told when it resets in one
 * sentence, and because the reset needs no per-user state to compute.
 */

/** `YYYY-MM-DD` in UTC — the key both allowance tables are bucketed by. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The instant the current allowance period ends. */
export function nextUtcMidnight(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1),
  );
}

/** Whole seconds until `target`, never negative — ready for `Retry-After`. */
export function secondsUntil(target: Date, from: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - from.getTime()) / 1000));
}
