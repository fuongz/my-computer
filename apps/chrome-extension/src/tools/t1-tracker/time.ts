/**
 * "in 6 days", "2 hours ago", "yesterday".
 *
 * Its own file because two screens need it: the schedule stamps its own refresh
 * with it, and the bracket stamps the seeding it read from the wiki. panel.ts
 * already imports tournament.ts, so the alternative was a cycle.
 *
 * `undefined` as the locale means "whatever the browser is set to", so this
 * reads in the user's own language without the tool asking which.
 */

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** The coarsest unit that still reads as a duration. */
export function relative(epochMs: number): string {
	const minutes = Math.round((epochMs - Date.now()) / 60_000);
	if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");

	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");

	return RELATIVE.format(Math.round(hours / 24), "day");
}
