/**
 * Who may change other people's limits.
 *
 * An allowlist of email addresses in the environment, deliberately NOT a role column.
 * Privilege that lives in deployment config cannot be granted by anything the running
 * app does — no bug, no injection and no forgotten endpoint can write itself an admin
 * flag, because there is no flag to write. Changing who is an admin is a deploy, which
 * is the correct amount of friction for it.
 *
 * Shared because both the API and the web app answer the same question.
 */
export function parseAdminEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** False for an empty allowlist: a deployment with no admins configured has none. */
export function isAdminEmail(
  allowlist: readonly string[],
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * The bounds an override may be set to through an API or a UI.
 *
 * A hand-written SQL update can still put anything in the column and the read path
 * clamps it; this is about what a *request* is allowed to ask for, where a fat-fingered
 * number should be a 400 rather than a surprise.
 */
export const ALLOWANCE_LIMIT_MAX = 100_000;

export function isValidAllowanceLimit(value: unknown): value is number | null {
  if (value === null) return true;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ALLOWANCE_LIMIT_MAX
  );
}
