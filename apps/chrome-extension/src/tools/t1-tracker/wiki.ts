/**
 * Leaguepedia, read for the one thing lolesports will not say.
 *
 * A play-in or playoff bracket is drawn up weeks before anyone qualifies for
 * it. Riot's API describes that bracket's shape but calls every slot TBD; the
 * wiki's editors write down which seed each slot is for — "1 Rise", "5/6" — and
 * which teams already have a place in the stage. That is what this reads.
 *
 * Three routes into the wiki were tried (2026-08-23):
 *
 *   action=cargoquery   the structured tables. Answers `ratelimited` on the
 *                       first anonymous request; Cargo needs an account.
 *   ?action=raw         Cloudflare's interstitial, HTTP 403.
 *   action=query        works anonymously, sends `access-control-allow-origin:
 *     &prop=revisions   *`, and takes every page title in one request.
 *
 * So this parses hand-edited wikitext, and treats it accordingly: everything
 * here is optional. Any failure — a moved page, a template variant, a seed
 * string that doesn't read, a count that doesn't line up — returns nothing and
 * leaves the bracket exactly as api.ts described it. The wiki may upgrade a
 * label. It may never build the bracket.
 *
 * Reads are gated by a setting that is off by default; see panel.ts. This is
 * the only file in the extension that talks to a server we don't otherwise use.
 */

import { readCachedEntry, writeEntry } from "./api";
import type { Tournament } from "./api";

const API = "https://lol.fandom.com/api.php";

const WIKI_CACHE_KEY = "fz.t1.wiki.v1";

/**
 * How old a stored answer may be before it is read again.
 *
 * An hour, not the day the other reference caches use: these pages are edited
 * the moment a group finishes, and a seed the wiki settled this morning is the
 * whole point of asking. Each tournament carries its own stamp inside the blob,
 * so opening one is not a refresh of the others.
 */
const SEEDING_TTL_MS = 60 * 60 * 1000;

/** Titles per request; MediaWiki allows 50, and no league needs half of that. */
const MAX_PAGES = 14;

/**
 * How long a wiki read may take before it is abandoned.
 *
 * The bracket waits for this, so it has to be short: a server that accepts a
 * connection and then says nothing would otherwise hold up a view that Riot's
 * answer alone can already draw.
 */
const TIMEOUT_MS = 4000;

/**
 * Where each league's stage pages live.
 *
 * There is no id joining a lolesports tournament to a wiki page, and the naming
 * is per-league and hand-maintained — `LCK/2026 Season/Season Playoffs` beside
 * `2026 LoL KeSPA Cup` beside `2026 Season World Championship/Main Event`. So it
 * is a table, keyed by the league slugs api.ts already tracks.
 *
 * A `hub` is a season page that links its own stage subpages, which is how the
 * LCK is laid out; `pages` are titles to try directly. A league that yields
 * nothing costs one cached miss and changes nothing on screen — as MSI, Worlds
 * and EWC do today, their brackets being drawn only once a Swiss or group stage
 * has finished.
 */
const WIKI_PAGES: Record<string, (year: string) => { hub?: string; pages: string[] }> = {
	lck: (year) => ({ hub: `LCK/${year} Season`, pages: [] }),
	kespa_cup: (year) => ({ pages: [`${year} LoL KeSPA Cup`] }),
	worlds: (year) => ({
		pages: [
			`${year} Season World Championship`,
			`${year} Season World Championship/Main Event`,
		],
	}),
	msi: (year) => ({ pages: [`${year} Mid-Season Invitational`] }),
	first_stand: (year) => ({ pages: [`${year} First Stand`] }),
	ewc_lol: (year) => ({ pages: [`Esports World Cup ${year}`] }),
};

/* --- shapes ----------------------------------------------------------- */

/** A team the wiki already places in this stage, and the seed it holds. */
export interface WikiEntrant {
	/** As the wiki writes it: "Dplus Kia", "KT Rolster", "T1". */
	team: string;
	/** As the wiki writes it: "Legend Group #2/3". */
	seed: string;
}

/** One `{{Bracket}}` that names the seeds entering it. */
export interface WikiBracket {
	/** The page it was read from, which is also what gets the credit. */
	page: string;
	/**
	 * The entry slots in reading order — `R1M1_seed_1`, `R1M1_seed_2`,
	 * `R1M2_seed_1`, … — as the wiki writes them: "1 Rise", "5/6", "A1".
	 */
	seeds: string[];
	/**
	 * The stage's known entrants, and only when this is the page's one seeded
	 * bracket. A page carrying two of them (the KeSPA Cup puts its play-ins and
	 * its knockouts on one page) has one participant list between them, and
	 * repeating it under both would claim more than the wiki said.
	 */
	entrants: WikiEntrant[];
}

export interface WikiSeeding {
	brackets: WikiBracket[];
	/** Epoch ms of the read that produced this, shown under the bracket. */
	fetchedAt: number;
}

/* --- fetching --------------------------------------------------------- */

/**
 * What the wiki knows about one tournament's brackets, or null.
 *
 * Costs one request for a league listed by `pages`, two for one behind a `hub`,
 * and nothing for the hour after that — including when the answer was nothing,
 * so a league the wiki doesn't cover isn't asked about again this hour either.
 */
export async function getWikiSeeding(
	tournament: Tournament,
): Promise<WikiSeeding | null> {
	const store = await readCachedEntry(WIKI_CACHE_KEY);
	const stored = isRecord(store) ? store[tournament.id] : undefined;

	// A null was stored too, meaning "asked, and the wiki had nothing" — worth
	// remembering for the same hour as an answer, and told apart from a key that
	// was never there at all.
	if (tournament.id in (isRecord(store) ? store : {})) {
		if (stored === null) return null;
		if (isSeeding(stored) && fresh(stored.fetchedAt)) return stored;
	}

	let seeding: WikiSeeding | null;
	try {
		seeding = await readWiki(tournament);
	} catch {
		// Rate limited, timed out, offline, blocked. Deliberately not cached: a
		// minute of bad network would otherwise turn this off for the hour.
		return isSeeding(stored) ? stored : null;
	}

	const merged = isRecord(store) ? { ...store } : {};
	merged[tournament.id] = seeding;
	await writeEntry(WIKI_CACHE_KEY, merged);
	return seeding;
}

/**
 * Whether a stored answer is still worth using.
 *
 * A stamp from the future means the clock moved; read again rather than trusting
 * it until it catches up — the same rule api.ts applies to its own caches.
 */
function fresh(fetchedAt: number): boolean {
	const age = Date.now() - fetchedAt;
	return age >= 0 && age < SEEDING_TTL_MS;
}

async function readWiki(tournament: Tournament): Promise<WikiSeeding | null> {
	const route = WIKI_PAGES[tournament.leagueSlug];
	if (!route) return null;

	const year = tournament.startDate.slice(0, 4);
	if (!/^\d{4}$/.test(year)) return null;

	const { hub, pages } = route(year);
	const titles = [...pages];
	if (hub) titles.push(...(await subpagesOf(hub)));
	if (titles.length === 0) return null;

	const brackets: WikiBracket[] = [];
	for (const [page, text] of await wikitext(titles.slice(0, MAX_PAGES))) {
		// A page for another stage of the same season is the common case behind a
		// hub, and its dates are the only thing that tells it apart.
		if (!overlaps(text, tournament)) continue;
		brackets.push(...parsePage(page, text));
	}

	return brackets.length > 0 ? { brackets, fetchedAt: Date.now() } : null;
}

/** The stage pages a season hub links, in the order it links them. */
async function subpagesOf(hub: string): Promise<string[]> {
	const text = (await wikitext([hub])).get(hub);
	if (!text) return [];

	const found = new Set<string>();
	const link = new RegExp(`\\[\\[(${escapeRegExp(hub)}/[^|\\]#]+)`, "g");
	for (const match of text.matchAll(link)) {
		const title = match[1]?.trim();
		if (title) found.add(title);
	}
	return [...found];
}

/** Page title → its current wikitext, for the pages that exist. */
async function wikitext(titles: string[]): Promise<Map<string, string>> {
	const url = new URL(API);
	url.searchParams.set("action", "query");
	url.searchParams.set("prop", "revisions");
	url.searchParams.set("rvprop", "content");
	url.searchParams.set("rvslots", "main");
	url.searchParams.set("titles", titles.join("|"));
	url.searchParams.set("format", "json");
	// Anonymous CORS. Without it the response has no allow-origin header at all
	// and the popup can't read what it just fetched.
	url.searchParams.set("origin", "*");

	const response = await fetch(url.toString(), {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`leaguepedia responded ${response.status}`);

	const body: unknown = await response.json();
	const pages = read(read(body, "query"), "pages");
	const found = new Map<string, string>();
	if (!pages) return found;

	for (const page of Object.values(pages)) {
		// A title that doesn't exist comes back with `missing` and no revision,
		// which is the same to us as a page we can't read.
		const title = isRecord(page) ? asText(page["title"]) : "";
		const revisions = isRecord(page) ? page["revisions"] : undefined;
		const first = Array.isArray(revisions) ? revisions[0] : undefined;
		const content = read(read(first, "slots"), "main")?.["*"];
		if (title && typeof content === "string") found.set(title, content);
	}
	return found;
}

/* --- parsing ---------------------------------------------------------- */

/**
 * Whether a page describes the stretch of time this tournament covers.
 *
 * The Infobox carries `sdate` and `edate`, and a lolesports tournament carries
 * its own range; a stage page belongs to the tournament when the two overlap.
 * A page without dates is not guessed about.
 */
function overlaps(text: string, tournament: Tournament): boolean {
	const start = field(text, "sdate");
	const end = field(text, "edate") || start;
	if (!start) return false;
	return start <= tournament.endDate && end >= tournament.startDate;
}

function field(text: string, name: string): string {
	const match = new RegExp(`\\|\\s*${name}\\s*=\\s*(\\d{4}-\\d{2}-\\d{2})`).exec(
		text,
	);
	return match?.[1] ?? "";
}

/** Every seeded bracket on one page, with the page's entrants where they fit. */
function parsePage(page: string, text: string): WikiBracket[] {
	const seeded: string[][] = [];
	for (const block of text.matchAll(/\{\{Bracket\|[^}]*\}\}/g)) {
		const seeds = parseSeeds(block[0]);
		if (seeds.length > 0) seeded.push(seeds);
	}
	if (seeded.length === 0) return [];

	const entrants = seeded.length === 1 ? parseEntrants(text) : [];
	return seeded.map((seeds) => ({ page, seeds, entrants }));
}

/**
 * A bracket's seeded slots, in reading order.
 *
 * The keys are `R<round>M<match>_seed_<side>`, and sorting by those three
 * numbers is what puts them in the order the bracket is read in — which is the
 * order they are matched to the API's own entry slots.
 */
function parseSeeds(block: string): string[] {
	const slots: Array<{
		round: number;
		match: number;
		side: number;
		label: string;
	}> = [];

	for (const found of block.matchAll(
		/\|\s*R(\d+)M(\d+)_seed_(\d+)\s*=\s*([^\n|}]*)/g,
	)) {
		const label = (found[4] ?? "").trim();
		if (!label) continue;
		slots.push({
			round: Number(found[1]),
			match: Number(found[2]),
			side: Number(found[3]),
			label,
		});
	}

	slots.sort(
		(a, b) => a.round - b.round || a.match - b.match || a.side - b.side,
	);
	return slots.map((slot) => slot.label);
}

/**
 * The teams the Participants section already places in this stage.
 *
 * `{{TeamRoster|team=…}}` is followed by a `|seed=…` only while qualification
 * is partly settled, which is exactly when it is worth reading: "T1 —
 * Legend Group #2/3" is a place in the playoffs that the API still calls TBD.
 * A roster without a seed is a tournament whose teams are all known, and says
 * nothing the bracket doesn't.
 */
function parseEntrants(text: string): WikiEntrant[] {
	const starts = [...text.matchAll(/\{\{TeamRoster\s*\|/g)].map(
		(match) => match.index ?? 0,
	);

	const entrants: WikiEntrant[] = [];
	for (const [at, start] of starts.entries()) {
		// One roster's own parameters and nobody else's: they end at its first
		// player line, and in any case where the next roster begins — a roster with
		// no players listed would otherwise read the seed off the one below it.
		const until = starts[at + 1] ?? text.length;
		const head = unlink(
			text.slice(start, until).split("{{TeamRoster/Line")[0] ?? "",
		);

		// Unlinked first: the value is usually `[[Some/Page|Legend Group #5]]`, and
		// the pipe inside that link is not the end of the parameter.
		const team = /\|\s*team\s*=\s*([^\n|}]+)/.exec(head)?.[1]?.trim();
		const seed = /\|\s*seed\s*=\s*([^\n|}]+)/.exec(head)?.[1]?.trim();
		if (team && seed) entrants.push({ team, seed });
	}
	return entrants;
}

/** `[[Some/Page|Legend Group #5]]` → `Legend Group #5`. */
function unlink(value: string): string {
	return value
		.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/'{2,}/g, "")
		.trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* --- narrowing -------------------------------------------------------- */

function isSeeding(value: unknown): value is WikiSeeding {
	if (!isRecord(value)) return false;
	if (typeof value["fetchedAt"] !== "number") return false;

	const brackets = value["brackets"];
	return (
		Array.isArray(brackets) &&
		brackets.every(
			(bracket) =>
				isRecord(bracket) &&
				typeof bracket["page"] === "string" &&
				Array.isArray(bracket["seeds"]) &&
				Array.isArray(bracket["entrants"]),
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(value: unknown, key: string): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const nested = value[key];
	return isRecord(nested) ? nested : null;
}

function asText(value: unknown): string {
	return typeof value === "string" ? value : "";
}
