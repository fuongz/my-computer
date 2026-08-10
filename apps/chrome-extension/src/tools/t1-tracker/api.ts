/**
 * Everything this tool fetches, normalises and caches.
 *
 * The API is lolesports.com's own backend. It answers with CORS `*`, so the
 * popup calls it directly and the extension needs no background worker — but it
 * is undocumented, so nothing it returns is trusted: every field is narrowed on
 * the way in and anything that doesn't parse is dropped rather than rendered.
 *
 * Four things get fetched, on three different clocks:
 *
 *   the schedule    every 10 minutes, on opening the panel
 *   league badges   daily; they change about never
 *   tournaments     daily; date ranges change about once a split
 *   standings       every 10 minutes, and only for a tournament actually opened
 */

/** lolesports.com's own backend, which serves CORS `*` and takes an api key. */
const API_BASE = "https://esports-api.lolesports.com/persisted/gw";

/**
 * The key lolesports.com ships in its own web client.
 *
 * This endpoint is undocumented and unversioned, so Riot can rotate this value
 * or drop the route and take the tool down with it. It is deliberately the only
 * copy in the repo, so that repair is a one-line edit.
 */
const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";

/** The team everything is filtered down to, matched on `team.code`. */
const TEAM_CODE = "T1";

/**
 * Every league T1 can turn up in.
 *
 * Schedule events name their league by slug but not by id, and tournaments are
 * only reachable by id — so both are kept here and joined on the slug.
 */
const LEAGUES = [
	{ id: "98767991310872058", slug: "lck" },
	{ id: "116929044967296666", slug: "kespa_cup" },
	{ id: "98767975604431411", slug: "worlds" },
	{ id: "98767991325878492", slug: "msi" },
	{ id: "113464388705111224", slug: "first_stand" },
	{ id: "116838530616006090", slug: "ewc_lol" },
];

const SCHEDULE_CACHE_KEY = "fz.t1.cache.v1";
const LEAGUE_CACHE_KEY = "fz.t1.leagues.v1";
const TOURNAMENT_CACHE_KEY = "fz.t1.tournaments.v1";
const STANDINGS_CACHE_KEY = "fz.t1.standings.v1";

/** How old a cached list may be before opening the panel refreshes it. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Reference data — badges and tournament date ranges — barely moves. */
const REFERENCE_TTL_MS = 24 * 60 * 60 * 1000;

/** How many rows each half of the schedule shows. */
const UPCOMING_LIMIT = 5;
const RECENT_LIMIT = 5;

/* --- shapes ----------------------------------------------------------- */

/** One side of a match. */
export interface MatchTeam {
	code: string;
	name: string;
	/** An https URL, or "" when there is no usable logo. */
	image: string;
	/** Games won. Only meaningful once the match has started. */
	score: number;
	isT1: boolean;
}

/** One T1 fixture, flattened out of the API's event shape. */
export interface T1Match {
	/** The API's match id; only used to dedupe across pages. */
	id: string;
	/** ISO 8601 in UTC, as given. */
	startTime: string;
	state: "unstarted" | "inProgress" | "completed";
	/** The competition, e.g. "LCK". */
	league: string;
	/** Its slug, which joins a match to its badge and its tournaments. */
	leagueSlug: string;
	/** Stage within it, e.g. "Week 12" or "Finals". May be empty. */
	block: string;
	/** Games needed to take the match; 0 when the API doesn't say. */
	bestOf: number;
	/** Both sides, in the order the API lists them. */
	teams: [MatchTeam, MatchTeam];
}

export interface T1Schedule {
	matches: T1Match[];
	/** Epoch ms of the fetch that produced this list. */
	fetchedAt: number;
}

export interface Tournament {
	id: string;
	slug: string;
	/** ISO dates, `YYYY-MM-DD`. */
	startDate: string;
	endDate: string;
	/** Carried through from the league it was fetched for. */
	leagueSlug: string;
	leagueName: string;
}

/** A team as it appears inside a standings table or a bracket. */
export interface StandingTeam {
	code: string;
	name: string;
	image: string;
	isT1: boolean;
}

export interface RankingRow {
	ordinal: number;
	teams: StandingTeam[];
	wins: number;
	losses: number;
}

export interface BracketTeam extends StandingTeam {
	score: number;
	won: boolean;
	/**
	 * Which earlier match this team arrived from, as that match's
	 * `structuralId`. Empty for a seeded team, which is what the first round of
	 * any bracket is made of.
	 */
	fromMatch: string;
}

export interface BracketMatch {
	id: string;
	/** Stable within a section; what {@link BracketTeam.fromMatch} points at. */
	structuralId: string;
	state: string;
	teams: BracketTeam[];
}

/** One named round — "Upper Bracket - Semifinals" — and its matches. */
export interface BracketRound {
	name: string;
	matches: BracketMatch[];
}

/** A column of the bracket. Rounds in the same column run in parallel. */
export interface BracketColumn {
	rounds: BracketRound[];
}

export interface StandingsSection {
	name: string;
	/** Round-robin table, or knockout bracket. The API tells us which. */
	kind: "group" | "bracket";
	rankings: RankingRow[];
	columns: BracketColumn[];
}

export interface StandingsStage {
	name: string;
	sections: StandingsSection[];
}

export interface Standings {
	tournamentId: string;
	stages: StandingsStage[];
	fetchedAt: number;
}

/* --- the schedule ----------------------------------------------------- */

/** Below this many upcoming fixtures, reach forward one more page. */
const MIN_UPCOMING = 3;

/** Hard ceiling on requests per schedule refresh, paging included. */
const MAX_REQUESTS = 2;

/**
 * Fetch T1's fixtures and cache them.
 *
 * The single 80-event window is shared across all six leagues, so a busy
 * stretch in leagues T1 isn't playing can push its fixtures off the end. When
 * the first page comes back light on upcoming matches, page forward once — and
 * only once, so a quiet T1 off-season can't turn this into a crawl.
 */
export async function fetchSchedule(): Promise<T1Schedule> {
	const matches = new Map<string, T1Match>();
	let pageToken: string | undefined;

	for (let request = 0; request < MAX_REQUESTS; request++) {
		const page = await requestSchedule(pageToken);
		for (const match of page.matches) matches.set(match.id, match);

		const upcoming = [...matches.values()].filter(
			(match) => match.state === "unstarted",
		).length;
		if (upcoming >= MIN_UPCOMING || !page.newer) break;
		pageToken = page.newer;
	}

	const schedule: T1Schedule = {
		matches: [...matches.values()].sort(
			(a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
		),
		fetchedAt: Date.now(),
	};

	await writeCache(SCHEDULE_CACHE_KEY, schedule);
	return schedule;
}

/** The three lists the panel draws, in the order it draws them. */
export interface SplitSchedule {
	live: T1Match[];
	upcoming: T1Match[];
	recent: T1Match[];
}

/** Split a time-ascending match list into what the panel actually shows. */
export function splitMatches(matches: T1Match[]): SplitSchedule {
	return {
		live: matches.filter((match) => match.state === "inProgress"),
		upcoming: matches
			.filter((match) => match.state === "unstarted")
			.slice(0, UPCOMING_LIMIT),
		// The tail of the completed matches is the most recent; newest first.
		recent: matches
			.filter((match) => match.state === "completed")
			.slice(-RECENT_LIMIT)
			.reverse(),
	};
}

export async function readCachedSchedule(): Promise<T1Schedule | null> {
	const raw = await readCache(SCHEDULE_CACHE_KEY);
	if (!isRecord(raw)) return null;

	const matches = raw["matches"];
	const fetchedAt = raw["fetchedAt"];
	if (!Array.isArray(matches) || typeof fetchedAt !== "number") return null;

	// Cached entries were normalised on the way in, but a shipped change to
	// T1Match leaves older ones half-shaped — hence the version in the key, and
	// this second check for anything that slipped through.
	const usable = matches.filter(
		(match): match is T1Match =>
			isRecord(match) &&
			typeof match["id"] === "string" &&
			typeof match["startTime"] === "string" &&
			Array.isArray(match["teams"]) &&
			match["teams"].length === 2,
	);
	return { matches: usable, fetchedAt };
}

/* --- league badges ---------------------------------------------------- */

/** Slug → logo URL, for the badge on a match card. */
export type LeagueBadges = Record<string, string>;

export async function getLeagueBadges(): Promise<LeagueBadges> {
	const cached = await readFresh(LEAGUE_CACHE_KEY, REFERENCE_TTL_MS);
	if (isRecord(cached)) {
		const badges: LeagueBadges = {};
		for (const [slug, url] of Object.entries(cached)) {
			if (typeof url === "string") badges[slug] = url;
		}
		return badges;
	}

	const body = await request("getLeagues", {});
	const leagues = read(body, "data")?.["leagues"];
	const badges: LeagueBadges = {};
	if (Array.isArray(leagues)) {
		for (const league of leagues) {
			if (!isRecord(league)) continue;
			const slug = asText(league["slug"]);
			const image = secureUrl(league["image"]);
			if (slug && image) badges[slug] = image;
		}
	}

	await writeCache(LEAGUE_CACHE_KEY, badges);
	return badges;
}

/* --- tournaments ------------------------------------------------------ */

/**
 * The tournaments T1 has matches in, newest first.
 *
 * Tournaments are only addressable by league id, and a schedule event names its
 * league by slug alone — so this asks per league rather than batching. Batching
 * is possible, but the response drops the league id from each block, leaving
 * nothing to check the pairing against.
 */
export async function getTournamentsFor(
	matches: T1Match[],
): Promise<Tournament[]> {
	const leagues = new Map<string, string>();
	for (const match of matches) {
		if (match.leagueSlug) leagues.set(match.leagueSlug, match.league);
	}

	const found = new Map<string, Tournament>();
	for (const [slug, name] of leagues) {
		for (const tournament of await tournamentsForLeague(slug, name)) {
			// Only the ones T1 is actually playing in, by date.
			const playing = matches.some(
				(match) =>
					match.leagueSlug === slug && within(match.startTime, tournament),
			);
			if (playing) found.set(tournament.id, tournament);
		}
	}

	return [...found.values()].sort((a, b) =>
		b.startDate.localeCompare(a.startDate),
	);
}

/**
 * The tournament a fixture belongs to, matched on its league and its date —
 * the schedule endpoint names neither a tournament nor even a league id.
 */
export function tournamentForMatch(
	match: T1Match,
	tournaments: Tournament[],
): Tournament | undefined {
	return tournaments.find(
		(tournament) =>
			tournament.leagueSlug === match.leagueSlug &&
			within(match.startTime, tournament),
	);
}

function within(startTime: string, tournament: Tournament): boolean {
	const day = startTime.slice(0, 10);
	return day >= tournament.startDate && day <= tournament.endDate;
}

async function tournamentsForLeague(
	slug: string,
	name: string,
): Promise<Tournament[]> {
	const league = LEAGUES.find((entry) => entry.slug === slug);
	if (!league) return [];

	const store = await readFresh(TOURNAMENT_CACHE_KEY, REFERENCE_TTL_MS);
	const cached = isRecord(store) ? store[slug] : undefined;
	if (Array.isArray(cached)) {
		return cached.filter((entry): entry is Tournament => isTournament(entry));
	}

	const body = await request("getTournamentsForLeague", {
		leagueId: league.id,
	});
	const blocks = read(body, "data")?.["leagues"];
	const first = Array.isArray(blocks) && isRecord(blocks[0]) ? blocks[0] : null;
	const raw = first?.["tournaments"];

	const tournaments: Tournament[] = [];
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			if (!isRecord(entry)) continue;
			const tournament: Tournament = {
				id: asText(entry["id"]),
				slug: asText(entry["slug"]),
				startDate: asText(entry["startDate"]),
				endDate: asText(entry["endDate"]),
				leagueSlug: slug,
				leagueName: name,
			};
			if (isTournament(tournament)) tournaments.push(tournament);
		}
	}

	// Merge into whatever other leagues are already cached, and restamp the
	// whole blob — one key, one write, one expiry for all of them.
	const merged = isRecord(store) ? { ...store } : {};
	merged[slug] = tournaments;
	await writeCache(TOURNAMENT_CACHE_KEY, merged);
	return tournaments;
}

function isTournament(value: unknown): value is Tournament {
	return (
		isRecord(value) &&
		typeof value["id"] === "string" &&
		value["id"] !== "" &&
		typeof value["startDate"] === "string" &&
		typeof value["endDate"] === "string"
	);
}

/* --- standings -------------------------------------------------------- */

export async function getStandings(tournamentId: string): Promise<Standings> {
	const store = await readFresh(STANDINGS_CACHE_KEY, CACHE_TTL_MS);
	const cached = isRecord(store) ? store[tournamentId] : undefined;
	if (isRecord(cached) && Array.isArray(cached["stages"])) {
		return {
			tournamentId,
			stages: cached["stages"] as StandingsStage[],
			fetchedAt: asCount(cached["fetchedAt"]),
		};
	}

	const body = await request("getStandingsV3", { tournamentId });
	const blocks = read(body, "data")?.["standings"];
	const first = Array.isArray(blocks) && isRecord(blocks[0]) ? blocks[0] : null;
	const rawStages = first?.["stages"];

	const stages: StandingsStage[] = [];
	if (Array.isArray(rawStages)) {
		for (const stage of rawStages) {
			if (!isRecord(stage)) continue;
			const sections = normaliseSections(stage["sections"]);
			if (sections.length > 0) {
				stages.push({ name: asText(stage["name"]), sections });
			}
		}
	}

	const standings: Standings = { tournamentId, stages, fetchedAt: Date.now() };

	// Same one-key pattern as tournaments; the stamp is per blob, so opening a
	// second tournament refreshes the first one's copy too. Cheap and simpler
	// than a stamp per entry.
	const merged = isRecord(store) ? { ...store } : {};
	merged[tournamentId] = { stages, fetchedAt: standings.fetchedAt };
	await writeCache(STANDINGS_CACHE_KEY, merged);
	return standings;
}

function normaliseSections(raw: unknown): StandingsSection[] {
	if (!Array.isArray(raw)) return [];

	const sections: StandingsSection[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;

		const rankings = normaliseRankings(entry["rankings"]);
		const columns = normaliseColumns(entry["columns"]);
		if (rankings.length === 0 && columns.length === 0) continue;

		sections.push({
			name: asText(entry["name"]),
			// Trust the API's own word for it, and fall back to whichever half
			// actually came back with something.
			kind:
				entry["type"] === "group" || entry["type"] === "bracket"
					? entry["type"]
					: rankings.length > 0
						? "group"
						: "bracket",
			rankings,
			columns,
		});
	}
	return sections;
}

function normaliseRankings(raw: unknown): RankingRow[] {
	if (!Array.isArray(raw)) return [];

	const rows: RankingRow[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const teams = Array.isArray(entry["teams"]) ? entry["teams"] : [];
		if (teams.length === 0) continue;

		// Tied teams share one row, and so share one record.
		const record = read(teams[0], "record");
		rows.push({
			ordinal: asCount(entry["ordinal"]),
			teams: teams.map(standingTeam),
			wins: asCount(record?.["wins"]),
			losses: asCount(record?.["losses"]),
		});
	}
	return rows.sort((a, b) => a.ordinal - b.ordinal);
}

function normaliseColumns(raw: unknown): BracketColumn[] {
	if (!Array.isArray(raw)) return [];

	const columns: BracketColumn[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const cells = entry["cells"];
		if (!Array.isArray(cells)) continue;

		const rounds: BracketRound[] = [];
		for (const cell of cells) {
			if (!isRecord(cell)) continue;
			const matches = Array.isArray(cell["matches"]) ? cell["matches"] : [];
			const parsed = matches
				.map(bracketMatch)
				.filter((match): match is BracketMatch => match !== null);
			if (parsed.length > 0) {
				rounds.push({ name: asText(cell["name"]), matches: parsed });
			}
		}

		if (rounds.length > 0) columns.push({ rounds });
	}
	return columns;
}

function bracketMatch(raw: unknown): BracketMatch | null {
	if (!isRecord(raw)) return null;
	const teams = raw["teams"];
	if (!Array.isArray(teams) || teams.length === 0) return null;

	return {
		id: asText(raw["id"]),
		structuralId: asText(raw["structuralId"]),
		state: asText(raw["state"]),
		teams: teams.map((team): BracketTeam => {
			const result = read(team, "result");
			const origin = read(team, "origin");
			return {
				...standingTeam(team),
				score: asCount(result?.["gameWins"]),
				won: result?.["outcome"] === "win",
				// `seeding` means the team entered here rather than arriving from
				// an earlier match, so there is no line to draw.
				fromMatch:
					origin?.["type"] === "match" ? asText(origin["structuralId"]) : "",
			};
		}),
	};
}

function standingTeam(raw: unknown): StandingTeam {
	const team = isRecord(raw) ? raw : {};
	const code = asText(team["code"]);
	return {
		code,
		name: asText(team["name"]) || code,
		image: secureUrl(team["image"]),
		isT1: code === TEAM_CODE,
	};
}

/* --- requests --------------------------------------------------------- */

async function requestSchedule(
	pageToken?: string,
): Promise<{ matches: T1Match[]; newer: string | undefined }> {
	const params: Record<string, string> = {
		leagueId: LEAGUES.map((league) => league.id).join(","),
	};
	if (pageToken) params["pageToken"] = pageToken;

	const body = await request("getSchedule", params);
	const schedule = read(read(body, "data"), "schedule");
	const events = schedule?.["events"];
	if (!Array.isArray(events)) {
		throw new Error("lolesports returned an unfamiliar shape");
	}

	return {
		matches: events
			.map(normaliseEvent)
			.filter((match): match is T1Match => match !== null),
		newer: asText(read(schedule, "pages")?.["newer"]) || undefined,
	};
}

async function request(
	path: string,
	params: Record<string, string>,
): Promise<unknown> {
	const url = new URL(`${API_BASE}/${path}`);
	url.searchParams.set("hl", "en-US");
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url.toString(), {
		headers: { "x-api-key": API_KEY },
	});
	if (!response.ok) {
		throw new Error(`lolesports responded ${response.status}`);
	}
	return response.json();
}

/** One event → a T1 fixture, or null if it isn't one we can render. */
function normaliseEvent(raw: unknown): T1Match | null {
	if (!isRecord(raw)) return null;

	const match = read(raw, "match");
	if (!match) return null; // Non-match entries, e.g. shows.

	// Read straight off the object: read() narrows to plain records and would
	// reject the array.
	const rawTeams = match["teams"];
	if (!Array.isArray(rawTeams) || rawTeams.length !== 2) return null;

	const teams = rawTeams.map(matchTeam);
	const [home, away] = teams;
	if (!home || !away) return null;
	if (!home.isT1 && !away.isT1) return null;

	const startTime = asText(raw["startTime"]);
	if (!Number.isFinite(Date.parse(startTime))) return null;

	const league = read(raw, "league");
	const strategy = read(match, "strategy");

	return {
		id:
			asText(match["id"]) ||
			asText(raw["id"]) ||
			`${startTime}-${away.code}`,
		startTime,
		state: parseState(raw["state"], startTime),
		league: asText(league?.["name"]),
		leagueSlug: asText(league?.["slug"]),
		block: asText(raw["blockName"]),
		bestOf:
			strategy && strategy["type"] === "bestOf" ? asCount(strategy["count"]) : 0,
		teams: [home, away],
	};
}

function matchTeam(raw: unknown): MatchTeam {
	const team = isRecord(raw) ? raw : {};
	const code = asText(team["code"]);
	return {
		code,
		name: asText(team["name"]) || code,
		image: secureUrl(team["image"]),
		score: asCount(read(team, "result")?.["gameWins"]),
		isT1: code === TEAM_CODE,
	};
}

/**
 * An unrecognised state still has a kickoff time, which is enough to put the
 * match in the right half of the panel.
 */
function parseState(value: unknown, startTime: string): T1Match["state"] {
	if (value === "unstarted" || value === "inProgress" || value === "completed") {
		return value;
	}
	return Date.parse(startTime) > Date.now() ? "unstarted" : "completed";
}

/**
 * The API hands out logo URLs over plain http. The popup is a secure context,
 * so those load as mixed content and are blocked — upgrade them, and drop
 * anything that isn't http(s) at all.
 */
function secureUrl(value: unknown): string {
	const url = asText(value);
	if (url.startsWith("https://")) return url;
	if (url.startsWith("http://")) return `https://${url.slice(7)}`;
	return "";
}

/* --- the cache -------------------------------------------------------- */

/**
 * Whether a cached list is old enough to refresh behind the rendered one.
 * A timestamp from the future means the clock moved; refresh rather than
 * trusting it until it catches up.
 */
export function isStale(schedule: { fetchedAt: number }): boolean {
	const age = Date.now() - schedule.fetchedAt;
	return age >= CACHE_TTL_MS || age < 0;
}

/**
 * Every entry is stored as `{ at, value }`, so one stamp covers a whole blob
 * however many tournaments or leagues are inside it.
 *
 * An entry written before this wrapper existed has no `value` and reads as
 * nothing, which sends the caller to the network and overwrites it — so the
 * old shape heals itself rather than needing a migration.
 */
async function readCache(key: string): Promise<unknown> {
	return (await readEntry(key))?.value;
}

/** As above, but nothing older than `ttl`. */
async function readFresh(key: string, ttl: number): Promise<unknown> {
	const entry = await readEntry(key);
	if (!entry) return undefined;

	// A stamp from the future means the clock moved; refetch rather than
	// trusting it until it catches up.
	const age = Date.now() - entry.at;
	return age >= ttl || age < 0 ? undefined : entry.value;
}

async function readEntry(
	key: string,
): Promise<{ at: number; value: unknown } | null> {
	try {
		const stored = await chrome.storage.local.get(key);
		const entry = stored[key];
		if (!isRecord(entry) || !("value" in entry)) return null;
		return { at: asCount(entry["at"]), value: entry["value"] };
	} catch {
		// A blocked or empty storage area just means we start from nothing.
		return null;
	}
}

async function writeCache(key: string, value: unknown): Promise<void> {
	try {
		await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
	} catch {
		// Over quota or blocked. What's on screen is still good; we just pay for
		// a fetch again next time.
	}
}

/* --- narrowing -------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a nested object, or null when it isn't one. */
function read(value: unknown, key: string): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const nested = value[key];
	return isRecord(nested) ? nested : null;
}

function asText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: 0;
}
