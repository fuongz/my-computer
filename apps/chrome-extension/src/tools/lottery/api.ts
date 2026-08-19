/**
 * Reading one draw off xskt.com.vn.
 *
 * The site has no API, so this fetches the province's result page and parses
 * the one table on it that matters. The popup is an extension page and the
 * manifest asks for https://xskt.com.vn/*, so the request goes out directly
 * with no CORS involved and no background worker in the middle. The HTML is
 * only ever handed to DOMParser, which does not run scripts and whose document
 * is never attached to this one — nothing off that page can execute here.
 *
 * THE DATE TRAP
 *
 * Asking for a date a province did not draw does not 404. /xshg/ngay-16-8-2026
 * — a Sunday, and Hậu Giang draws on Saturdays — answers with Hậu Giang's
 * 16/08/2025 table under a heading that still reads 16/8, followed by 2014 and
 * 2008. Nothing in the numbers says they are from another year. What does say
 * so is the little "đọc kết quả" marker in each table's header, which carries
 * the table's real date:
 *
 *   <i class="dockq" data-url="hau-giang/16-08-2025">
 *
 * So every table is checked against the date that was asked for, and a page
 * with no table for that date reads as "no result", not as a result.
 *
 * A drawn result never changes, so each one is kept in chrome.storage.local
 * and re-read from there forever. Only "no result yet" goes uncached: that is
 * the answer that turns into a real one a few hours later.
 */

import type { DrawnNumbers, PrizeCode } from "./prizes";

const SITE = "https://xskt.com.vn";

const CACHE_KEY = "fz.xs.draws.v1";

/**
 * How many draws to keep. A draw is nine short lines of digits, so this is a
 * few kilobytes — the cap is here to bound the blob, not because it is close
 * to costing anything.
 */
const CACHE_LIMIT = 60;

/** One province's published result for one day. */
export interface Draw {
	/** The province slug it was fetched for. */
	slug: string;
	/** The date it belongs to, `YYYY-MM-DD`, as verified against the page. */
	date: string;
	numbers: DrawnNumbers;
	/** Epoch ms of the fetch that produced it. */
	fetchedAt: number;
}

/**
 * The table's row labels, as printed. Province pages write "G8" and the
 * region-wide ones "G.8", so the dot is stripped before the lookup.
 */
const ROW_LABELS: Record<string, PrizeCode> = {
	ĐB: "db",
	DB: "db",
	G1: "g1",
	G2: "g2",
	G3: "g3",
	G4: "g4",
	G5: "g5",
	G6: "g6",
	G7: "g7",
	G8: "g8",
};

export function drawUrl(slug: string, date: string): string {
	const [year, month, day] = date.split("-");
	// The site's own links are unpadded — /ngay-15-8-2026, not /ngay-15-08-2026.
	return `${SITE}/${slug}/ngay-${Number(day)}-${Number(month)}-${year}`;
}

/**
 * The published result for one province on one day, or null when the site has
 * nothing for that exact date.
 *
 * Throws only when the page could not be reached at all, which is the one case
 * worth telling the user to try again about.
 */
export async function getDraw(slug: string, date: string): Promise<Draw | null> {
	const cached = await readCachedDraw(slug, date);
	if (cached) return cached;

	const response = await fetch(drawUrl(slug, date));
	if (!response.ok) {
		throw new Error(`xskt.com.vn answered ${response.status}`);
	}

	const draw = parseDraw(await response.text(), slug, date);
	if (draw) await cacheDraw(draw);
	return draw;
}

/**
 * Pull the one table that belongs to `date` out of a province page.
 *
 * Exported for the preview script, which parses a fixture rather than a live
 * page, and so that the trap above is testable without the network.
 */
export function parseDraw(
	html: string,
	slug: string,
	date: string,
): Draw | null {
	const doc = new DOMParser().parseFromString(html, "text/html");

	for (const table of doc.querySelectorAll("table.result")) {
		if (tableDate(table) !== date) continue;

		const numbers = readNumbers(table);
		// A table for the right date but with nothing in it is not a result. The
		// đặc biệt is the row that decides: everything else can be missing from a
		// half-published draw, that one cannot.
		if (!numbers.db?.length) continue;

		return { slug, date, numbers, fetchedAt: Date.now() };
	}

	return null;
}

/** The real date of a result table, as `YYYY-MM-DD`, or "" when it says none. */
function tableDate(table: Element): string {
	const stamp = table
		.querySelector("i.dockq")
		?.getAttribute("data-url")
		?.match(/(\d{2})-(\d{2})-(\d{4})/);
	return stamp ? `${stamp[3]}-${stamp[2]}-${stamp[1]}` : "";
}

/**
 * The numbers in a result table, by prize.
 *
 * Rows are `<td title="Giải tám">G8</td><td><em>31</em></td>`, and giải tư
 * spans two rows with a rowspan — but its label and its numbers are still the
 * first two cells of one row, so reading each row's first two cells covers
 * every prize. The two cells after them are the đầu/đuôi index, which is the
 * same numbers again sliced by leading digit; taking only the second cell is
 * what keeps that out.
 */
function readNumbers(table: Element): DrawnNumbers {
	const numbers: DrawnNumbers = {};

	for (const row of table.querySelectorAll("tr")) {
		const cells = row.querySelectorAll("td");
		const label = cells[0]?.textContent?.replace(/[.\s]/g, "").toUpperCase();
		const code = label ? ROW_LABELS[label] : undefined;
		if (!code) continue;

		const cell = cells[1];
		const drawn = cell ? cellText(cell).match(/\d+/g) : null;
		if (drawn?.length) numbers[code] = drawn;
	}

	return numbers;
}

/**
 * A cell's text with its line breaks turned back into separators.
 *
 * Giải tư is printed over two lines — `65673<br>56983` — and a <br> contributes
 * nothing to textContent, so reading the cell directly runs those two numbers
 * together into one ten-digit number that matches nothing. Every prize with
 * more than three numbers wraps this way.
 */
function cellText(cell: Element): string {
	const copy = cell.cloneNode(true) as Element;
	for (const br of copy.querySelectorAll("br")) br.replaceWith(" ");
	return copy.textContent ?? "";
}

/* --- the cache -------------------------------------------------------- */

async function readCachedDraw(
	slug: string,
	date: string,
): Promise<Draw | null> {
	const store = await readStore();
	const entry = store[cacheKey(slug, date)];
	// Cached entries were shaped on the way in, but a shipped change to Draw
	// leaves older ones half-formed — hence the version in the key, and this
	// second check for anything that slipped through.
	return isDraw(entry) ? entry : null;
}

async function cacheDraw(draw: Draw): Promise<void> {
	const store = await readStore();
	store[cacheKey(draw.slug, draw.date)] = draw;

	// String keys keep their insertion order, so the oldest writes are the ones
	// at the front.
	const keys = Object.keys(store);
	for (const key of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) {
		delete store[key];
	}

	try {
		await chrome.storage.local.set({ [CACHE_KEY]: store });
	} catch {
		// Over quota or blocked. What is on screen is still good; we just pay
		// for the fetch again next time.
	}
}

async function readStore(): Promise<Record<string, unknown>> {
	try {
		const stored = await chrome.storage.local.get(CACHE_KEY);
		const store = stored[CACHE_KEY];
		return isRecord(store) ? { ...store } : {};
	} catch {
		// A blocked or empty storage area just means we start from nothing.
		return {};
	}
}

function cacheKey(slug: string, date: string): string {
	return `${slug}|${date}`;
}

function isDraw(value: unknown): value is Draw {
	return (
		isRecord(value) &&
		typeof value["slug"] === "string" &&
		typeof value["date"] === "string" &&
		isRecord(value["numbers"]) &&
		Array.isArray(value["numbers"]["db"])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
