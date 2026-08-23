/**
 * The tool's detail view.
 *
 * Two screens live in here. The schedule is the default: T1's next matches and
 * its last few results, as cards. From its Tournaments list you can open one
 * tournament's stages. Both get the same room — every popup screen uses the
 * tournament view's maximum footprint, so neither screen asks the shell for
 * additional space.
 *
 * Rendering is cache-first — whatever was stored paints straight away and the
 * network refresh swaps it out underneath, so opening the panel never starts on
 * a spinner once it has been opened before. The tool's on/off switch gates the
 * request itself: while it is off, nothing here touches the network. The one
 * request that goes anywhere other than lolesports.com — wiki.ts, for the seeds
 * an unfilled bracket is waiting on — is gated a second time, by a setting that
 * is off until asked for.
 *
 * Everything is built with local helpers rather than the popup's, so the tool
 * stays self-contained under src/tools/ and doesn't depend on the shell it is
 * drawn into. Styling is Tailwind utilities; the bare `t1-*` names next to them
 * carry no styles and exist to be addressed by scripts/preview-popup.ts.
 */

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { renderIcon } from "../../common/icons";
import { getToolStates } from "../../common/storage";
import { menu, type MenuRow } from "../../common/ui";
import { LEAGUEPEDIA_SETTING, T1_TRACKER_ID } from "./constants";
import {
	bracketPositions,
	fetchSchedule,
	getLeagueBadges,
	getStandings,
	getTournamentsFor,
	tournamentForMatch,
	isStale,
	readCachedSchedule,
	splitMatches,
	type BracketPosition,
	type LeagueBadges,
	type MatchTeam,
	type T1Match,
	type T1Schedule,
	type Tournament,
} from "./api";
import { relative } from "./time";
import { renderStandings } from "./tournament";
import { getWikiSeeding, type WikiSeeding } from "./wiki";

/*
 * Class strings shared between call sites, or picked between by a conditional.
 * Every one is a whole literal: Tailwind reads class names out of this source,
 * so anything assembled at runtime compiles to no CSS at all.
 */
const PANEL = "t1 flex flex-col gap-3.5";
const LIST = "t1-list flex flex-col gap-2";
const SECTION_TITLE =
	"t1-section-title mb-[7px] text-[11px] font-semibold tracking-wide text-muted uppercase";
const PLACEHOLDER =
	"t1-placeholder rounded-lg border border-dashed border-border px-3.5 py-5 text-center text-[11.5px] leading-relaxed text-muted";
const DATES = "t1-tourney-dates text-[10.5px] text-muted";
const BADGE =
	"t1-badge grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-logo";
const BADGE_IMG = "h-5 w-5 object-contain";
const SIDE_HOME =
	"t1-side t1-side-home flex min-w-0 items-center justify-end gap-[7px]";
const SIDE_AWAY =
	"t1-side t1-side-away flex min-w-0 items-center justify-start gap-[7px]";
/*
 * The palette has no hue to spend on "this is T1", so the other side steps back
 * instead: muted against full-strength ink.
 */
const SIDE_CODE =
	"t1-side-code text-[13px] font-bold tracking-tight whitespace-nowrap text-muted";
const SIDE_CODE_T1 =
	"t1-side-code text-[13px] font-bold tracking-tight whitespace-nowrap text-accent";
const SCORE_NUM =
	"t1-score-num text-[15px] font-bold data-[outcome=loss]:font-semibold data-[outcome=loss]:text-muted";
const SLASH = "t1-slash text-muted opacity-45";

/**
 * Guards against a slow fetch painting into a panel the user has already left
 * or toggled off. Every render claims a token; only the newest one may draw.
 */
let renderToken = 0;

/**
 * The tournaments behind the current schedule, so a match card can open its own
 * without another lookup. Filled in by {@link loadTournaments}; a card clicked
 * before that lands falls back to asking, which is a cache read by then.
 */
let known: Tournament[] = [];

/** What a match card needs to act on a click. */
interface CardContext {
	host: HTMLElement;
	token: number;
	badges: LeagueBadges;
	matches: T1Match[];
}

export function renderT1Panel(host: HTMLElement, enabled: boolean): void {
	const token = ++renderToken;

	if (!enabled) {
		host.replaceChildren(placeholder("Switch this on to load T1's schedule."));
		return;
	}

	host.replaceChildren(placeholder("Loading T1's schedule…"));
	void load(host, token);
}

async function load(host: HTMLElement, token: number): Promise<void> {
	// Badges are a 24-hour cache read on all but the first run, so asking for
	// them alongside the schedule costs nothing after that. An outage on them
	// alone is survivable — the cards just go without a league mark.
	const [stored, badges] = await Promise.all([
		readCachedSchedule(),
		getLeagueBadges().catch((): LeagueBadges => ({})),
	]);
	if (token !== renderToken) return;

	const cached = stored && stored.matches.length > 0 ? stored : null;
	if (cached) {
		paintSchedule(host, token, cached, badges);
		if (!isStale(cached)) return;
	}

	try {
		const fresh = await fetchSchedule();
		if (token !== renderToken) return;
		paintSchedule(host, token, fresh, badges);
	} catch {
		if (token !== renderToken) return;
		// A stale list beats an error page; only say so when there is nothing
		// to fall back on.
		if (cached) paintSchedule(host, token, cached, badges, "Couldn't refresh just now.");
		else host.replaceChildren(placeholder("Couldn't reach lolesports.com."));
	}
}

/* --- the schedule screen ---------------------------------------------- */

function paintSchedule(
	host: HTMLElement,
	token: number,
	schedule: T1Schedule,
	badges: LeagueBadges,
	warning?: string,
): void {
	const { live, upcoming, recent } = splitMatches(schedule.matches);
	const panel = el("div", PANEL);

	// Tournaments lead: they are the way into the brackets, and the schedule
	// underneath runs long enough to bury them. The slot is filled in behind the
	// matches — the list needs its own request, and there is no reason to hold
	// the fixtures back for it.
	const tournaments = el("div", "t1-tourneys");
	panel.append(tournaments);

	if (live.length + upcoming.length + recent.length === 0) {
		panel.append(placeholder("No T1 matches scheduled right now."));
	} else {
		const context: CardContext = {
			host,
			token,
			badges,
			matches: schedule.matches,
		};
		if (live.length > 0) panel.append(section("Live now", live, context));
		if (upcoming.length > 0) panel.append(section("Upcoming", upcoming, context));
		if (recent.length > 0) {
			panel.append(section("Recent results", recent, context));
		}
	}

	const footer = el(
		"p",
		"t1-foot flex flex-wrap gap-1.5 text-[10.5px] text-muted",
		`Updated ${relative(schedule.fetchedAt)}`,
	);
	if (warning) footer.append(el("span", "t1-warn text-warn", warning));
	panel.append(footer);

	host.replaceChildren(panel);
	void loadTournaments(host, token, tournaments, schedule.matches, badges);
}

async function loadTournaments(
	host: HTMLElement,
	token: number,
	slot: HTMLElement,
	matches: T1Match[],
	badges: LeagueBadges,
): Promise<void> {
	let tournaments: Tournament[] = [];
	try {
		tournaments = await getTournamentsFor(matches);
	} catch {
		return; // The schedule is the point; this part can just not appear.
	}
	known = tournaments;
	if (token !== renderToken || tournaments.length === 0) return;

	void loadRounds(host, token, matches, tournaments);

	const block = el("div", "t1-section");
	block.append(el("h3", SECTION_TITLE, "Tournaments"));
	block.append(
		menu(
			tournaments.map((tournament) =>
				tournamentRow(host, token, tournament, badges),
			),
		),
	);
	slot.replaceChildren(block);
}

/**
 * Say which round of a bracket each fixture is in.
 *
 * The schedule endpoint names the stage — "Knockouts", "Play In Knockouts" —
 * and stops there, so a card can say a match was in the Knockouts but not that
 * it was the semifinal. The standings know, and they share the schedule's match
 * ids, so this asks for the standings of the tournaments actually on screen and
 * fills the round in behind the cards.
 *
 * Behind them on purpose: the fixtures are the point of this screen and must
 * never wait on a second round of requests. Costs one request per tournament
 * being shown, cached for ten minutes, and the same cache the tournament view
 * reads — so opening one straight afterwards is free.
 */
async function loadRounds(
	host: HTMLElement,
	token: number,
	matches: T1Match[],
	tournaments: Tournament[],
): Promise<void> {
	const showing = new Set<string>();
	for (const match of matches) {
		const tournament = tournamentForMatch(match, tournaments);
		if (tournament) showing.add(tournament.id);
	}
	if (showing.size === 0) return;

	// Three is already more than a schedule has ever shown at once; the cap is
	// there so a strange schedule cannot turn this into a crawl.
	const positions = new Map<string, BracketPosition>();
	await Promise.all(
		[...showing].slice(0, 3).map(async (id) => {
			try {
				for (const [matchId, position] of bracketPositions(
					await getStandings(id),
				)) {
					positions.set(matchId, position);
				}
			} catch {
				// One tournament's standings failing costs that tournament's
				// rounds and nothing else.
			}
		}),
	);
	if (token !== renderToken) return;

	for (const match of matches) {
		const position = positions.get(match.id);
		if (!position) continue;

		const card = host.querySelector(`.t1-card[data-match-id="${match.id}"]`);
		const comp = card?.querySelector(".t1-card-comp");
		if (!comp) continue;

		// Appended rather than substituted: the stage is what tells two "Round 1"s
		// apart, and it is already there in the schedule's own words.
		comp.replaceWith(
			competition([match.league, match.block, position.round]),
		);

		const open = card?.querySelector(".t1-card-open");
		const label = open?.getAttribute("aria-label");
		if (open && label) {
			open.setAttribute("aria-label", `${position.round}. ${label}`);
		}
	}
}

function tournamentRow(
	host: HTMLElement,
	token: number,
	tournament: Tournament,
	badges: LeagueBadges,
): MenuRow {
	return {
		id: tournament.id,
		className: "t1-tourney",
		chip: logo(badges[tournament.leagueSlug] ?? "", BADGE, BADGE_IMG),
		title: tournament.leagueName || tournament.slug,
		subtitle: dateRange(tournament),
		openLabel: `Open ${tournament.leagueName || tournament.slug}`,
		onOpen: () => void openTournament(host, token, tournament, badges),
		trailing: icon(ArrowRight01Icon, "t1-chevron flex-none text-muted"),
	};
}

/* --- the tournament screen -------------------------------------------- */

async function openTournament(
	host: HTMLElement,
	token: number,
	tournament: Tournament,
	badges: LeagueBadges,
): Promise<void> {
	if (token !== renderToken) return;

	const view = el("div", PANEL);
	view.append(
		tournamentHeader(host, token, tournament, badges),
		placeholder("Loading the bracket…"),
	);
	host.replaceChildren(view);

	try {
		// Asked for together: the wiki read is a 24-hour cache hit on all but the
		// first open of a tournament, and it carries its own timeout, so waiting
		// for it costs a moment once a day rather than a second render and a view
		// that jumps under the pointer.
		const [standings, seeding] = await Promise.all([
			getStandings(tournament.id),
			seedingFor(tournament),
		]);
		if (token !== renderToken) return;

		view.replaceChildren(
			tournamentHeader(host, token, tournament, badges),
			renderStandings(standings, seeding),
		);
	} catch {
		if (token !== renderToken) return;
		view.replaceChildren(
			tournamentHeader(host, token, tournament, badges),
			placeholder("Couldn't load this tournament."),
		);
	}
}

/**
 * The wiki's seeds for this tournament, if they have been asked for.
 *
 * The setting is read here, next to the request it permits, rather than at the
 * panel's entry point: it is off by default, and switching it on re-renders the
 * panel, so the next open asks again without anything having to remember.
 */
async function seedingFor(tournament: Tournament): Promise<WikiSeeding | null> {
	try {
		const states = await getToolStates();
		const wanted =
			states[T1_TRACKER_ID]?.settings[LEAGUEPEDIA_SETTING] === "on";
		return wanted ? await getWikiSeeding(tournament) : null;
	} catch {
		// A blocked storage read is not a reason to fail the bracket.
		return null;
	}
}

function tournamentHeader(
	host: HTMLElement,
	token: number,
	tournament: Tournament,
	badges: LeagueBadges,
): HTMLElement {
	const head = el("div", "t1-tourney-head flex items-center gap-2.5");

	const back = el("button", "t1-back btn btn-ghost");
	back.type = "button";
	back.append(
		icon(ArrowLeft01Icon, "flex-none"),
		el("span", undefined, "Schedule"),
	);
	// Straight back to a fresh schedule render, off the same cache.
	back.addEventListener("click", () => {
		if (token === renderToken) void load(host, token);
	});

	const title = el("div", "t1-tourney-title");
	title.append(
		el(
			"h2",
			"text-sm font-[650]",
			tournament.leagueName || tournament.slug,
		),
		el("p", DATES, dateRange(tournament)),
	);

	head.append(
		back,
		logo(badges[tournament.leagueSlug] ?? "", BADGE, BADGE_IMG),
		title,
	);
	return head;
}

/* --- match cards ------------------------------------------------------ */

function section(
	title: string,
	matches: T1Match[],
	context: CardContext,
): HTMLElement {
	const block = el("div", "t1-section");
	block.append(el("h3", SECTION_TITLE, title));

	const list = el("ul", LIST);
	list.append(...matches.map((match) => card(match, context)));
	block.append(list);
	return block;
}

/**
 * One fixture, in two tiers: who played and the score above, which competition
 * it was below — the shape lolesports.com itself uses.
 */
function card(match: T1Match, context: CardContext): HTMLLIElement {
	const [home, away] = match.teams;
	const { badges } = context;

	const item = el(
		"li",
		"t1-card overflow-hidden rounded-lg border border-transparent bg-surface shadow-rest transition hover:shadow-raised data-[state=inProgress]:border-live/45",
	);
	item.dataset["state"] = match.state;
	// So the round this match turns out to be in can find its own card later.
	item.dataset["matchId"] = match.id;
	if (match.state === "completed") {
		const t1 = home.isT1 ? home : away;
		const other = home.isT1 ? away : home;
		item.dataset["result"] =
			t1.score > other.score ? "win" : t1.score < other.score ? "loss" : "draw";
	}

	const when = el(
		"div",
		"t1-card-when flex flex-col gap-px text-[10px] leading-tight text-muted",
	);
	when.append(...whenLines(match));

	const main = el(
		"div",
		"t1-card-main grid grid-cols-[62px_1fr_auto_1fr] items-center gap-2 px-3 py-2.5",
	);
	main.append(when, side(home, "home"), score(match), side(away, "away"));

	const foot = el(
		"div",
		"t1-card-foot grid grid-cols-[20px_1fr_auto] items-center gap-2 border-t border-border bg-sunken px-3 py-1.5 text-[10.5px] text-muted",
	);
	foot.append(
		logo(
			badges[match.leagueSlug] ?? "",
			"t1-league-badge grid h-5 w-5 place-items-center rounded-full bg-logo p-px",
			"h-full w-full object-contain",
		),
		competition([match.league, match.block]),
		el(
			"span",
			"t1-card-bo font-bold tracking-wide",
			match.bestOf > 0 ? `BO${match.bestOf}` : "",
		),
	);

	// The whole card opens the tournament it belongs to — the same screen the
	// Tournaments list leads to, reached from the fixture you were reading.
	const open = el(
		"button",
		"t1-card-open block w-full cursor-pointer text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
	);
	open.type = "button";
	open.setAttribute(
		"aria-label",
		`${match.league} ${match.block}: ${home.code} versus ${away.code}. Open the tournament.`,
	);
	open.addEventListener("click", () => void openFor(context, match));
	open.append(main, foot);

	item.append(open);
	return item;
}

/**
 * Open the tournament a fixture belongs to.
 *
 * The list usually landed while the schedule was being read, but a click that
 * beats it re-asks — by then that is a cache read, not a request.
 */
async function openFor(context: CardContext, match: T1Match): Promise<void> {
	let tournament = tournamentForMatch(match, known);

	if (!tournament) {
		try {
			known = await getTournamentsFor(context.matches);
		} catch {
			return;
		}
		if (context.token !== renderToken) return;
		tournament = tournamentForMatch(match, known);
	}

	if (tournament) {
		void openTournament(context.host, context.token, tournament, context.badges);
	}
}

/**
 * The competition, its stage, and the round inside that — as a breadcrumb.
 *
 * A chevron between them rather than a bullet: these three are not a list of
 * equals, they narrow. LCK, then the Knockouts, then the semifinal — and the
 * mark that says "into" is the one the tournament rows already use for it.
 * Repeats are dropped, because a stage and its round are sometimes the same
 * word and "Finals • Finals" says nothing twice.
 */
function competition(parts: string[]): HTMLElement {
	const line = el(
		"span",
		"t1-card-comp flex flex-wrap items-center justify-center gap-1 font-semibold",
	);

	const steps = parts
		.filter(Boolean)
		.filter((part, at, all) => all.indexOf(part) === at);

	for (const [at, part] of steps.entries()) {
		if (at > 0) {
			const step = el("span", "t1-card-step flex-none opacity-45");
			step.append(renderIcon(ArrowRight01Icon, "h-3 w-3"));
			line.append(step);
		}
		line.append(el("span", undefined, part));
	}
	return line;
}

/** The left column: when it starts, or that it is on right now. */
function whenLines(match: T1Match): HTMLElement[] {
	if (match.state === "inProgress") {
		return [
			el(
				"span",
				"t1-live self-start rounded-full bg-live px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white",
				"LIVE",
			),
		];
	}

	const at = Date.parse(match.startTime);
	if (!Number.isFinite(at)) return [];

	return [
		el("span", "t1-when-day", DAY.format(at)),
		el(
			"span",
			"t1-when-time text-xs font-[650] text-text tabular-nums",
			CLOCK.format(at),
		),
		el("span", "t1-when-rel opacity-70", relative(at)),
	];
}

function side(team: MatchTeam, position: "home" | "away"): HTMLElement {
	// Whole strings, not `t1-side-${position}` — Tailwind reads class names out
	// of this file, so a name spliced together at runtime compiles to nothing.
	const wrapper = el("div", position === "home" ? SIDE_HOME : SIDE_AWAY);
	if (team.isT1) wrapper.dataset["t1"] = "true";

	const code = el(
		"span",
		team.isT1 ? SIDE_CODE_T1 : SIDE_CODE,
		team.code || "TBD",
	);
	const mark = logo(
		team.image,
		"t1-side-logo grid h-6 w-6 flex-none place-items-center rounded-full bg-logo p-0.5",
		"h-full w-full object-contain",
	);

	// Codes read outward from the score, so the logos meet in the middle.
	wrapper.append(...(position === "home" ? [code, mark] : [mark, code]));
	return wrapper;
}

function score(match: T1Match): HTMLElement {
	const [home, away] = match.teams;
	const wrapper = el(
		"div",
		"t1-card-score flex items-center gap-[7px] tabular-nums",
	);

	if (match.state === "unstarted") {
		wrapper.append(el("span", SLASH, "/"));
		return wrapper;
	}

	// Mark the winner so the stylesheet can dim the other number; a completed
	// card otherwise reads as two equally-weighted scores.
	const decided = match.state === "completed" && home.score !== away.score;
	const homeNum = el("span", SCORE_NUM, String(home.score));
	const awayNum = el("span", SCORE_NUM, String(away.score));
	if (decided) {
		homeNum.dataset["outcome"] = home.score > away.score ? "win" : "loss";
		awayNum.dataset["outcome"] = away.score > home.score ? "win" : "loss";
	}

	wrapper.append(homeNum, el("span", SLASH, "/"), awayNum);
	return wrapper;
}

/* --- time ------------------------------------------------------------- */

/*
 * `undefined` as the locale means "whatever the browser is set to", which is
 * also what decides the timezone — so kickoffs read in the user's own clock
 * without this tool ever knowing where they are.
 */
const DAY = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
});
const CLOCK = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});
const MONTH = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
});

function dateRange(tournament: Tournament): string {
	const from = Date.parse(`${tournament.startDate}T00:00:00Z`);
	const to = Date.parse(`${tournament.endDate}T00:00:00Z`);
	if (!Number.isFinite(from) || !Number.isFinite(to)) return "";
	return `${MONTH.format(from)} – ${MONTH.format(to)}`;
}

/* --- dom -------------------------------------------------------------- */

/** An icon in a sized box, so it can sit inline with text. */
function icon(data: Parameters<typeof renderIcon>[0], className: string): HTMLSpanElement {
	const wrapper = el("span", className);
	wrapper.append(renderIcon(data, "h-4 w-4"));
	return wrapper;
}

/**
 * A logo, or an empty box.
 *
 * No text fallback: every logo here sits beside the name or code it stands for,
 * so repeating it on a failed load just reads as "T1 T1".
 */
function logo(src: string, wrapperClass: string, imgClass: string): HTMLElement {
	const wrapper = el("span", wrapperClass);
	if (!src) return wrapper;

	const image = el("img", imgClass);
	image.src = src;
	image.alt = "";
	image.loading = "lazy";
	image.addEventListener("error", () => image.remove(), { once: true });
	wrapper.append(image);
	return wrapper;
}

function placeholder(text: string): HTMLElement {
	return el("p", PLACEHOLDER, text);
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
