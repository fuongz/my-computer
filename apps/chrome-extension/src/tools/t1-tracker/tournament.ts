/**
 * The tournament sub-view: one tournament's stages, stacked.
 *
 * A stage's sections come in two shapes and the API says which — a `group` is a
 * round-robin table, a `bracket` is columns of named rounds. Both are drawn
 * here; the panel only decides when to show them.
 *
 * A bracket is normally drawn up long before it can be filled in — the play-ins
 * and the playoffs both exist in full while the group stage is still being
 * played — so an undecided slot says where its team will come from rather than
 * just "TBD": `Winner R1`, `Loser UB R2`, `Seed 3`, `Qualifier`, `Selection`.
 * Every one of those is read off the team's own `origin`; none is guessed from
 * the layout.
 *
 * The connector lines come from the same field, which is what makes them exact,
 * and a loser's drop into the lower bracket is dashed. They are drawn as one SVG
 * sized to the grid, from geometry that only exists after layout — hence the
 * ResizeObserver rather than a draw call at build time.
 *
 * When wiki.ts has something to add — it is asked only if the setting is on — an
 * entry slot says which seed it is for instead of just "Qualifier", and the
 * stage lists the teams already placed in it. That is the only thing a second
 * source is allowed to do here: relabel a slot the API left empty. The bracket
 * itself is always Riot's.
 */

import type {
	BracketMatch,
	BracketOrigin,
	BracketTeam,
	RankingRow,
	Standings,
	StandingsSection,
	StandingsStage,
	StandingTeam,
} from "./api";
import { relative } from "./time";
import type { WikiBracket, WikiSeeding } from "./wiki";

export function renderStandings(
	standings: Standings,
	seeding?: WikiSeeding | null,
): HTMLElement {
	// Whatever bracket was on screen before is gone the moment this returns.
	disposeConnectors();

	const view = el("div", "t1-tournament flex flex-col gap-5");

	const stages = standings.stages.filter((stage) => stage.sections.length > 0);
	if (stages.length === 0) {
		view.append(
			el("p", PLACEHOLDER, "This tournament hasn't been drawn up yet."),
		);
		return view;
	}

	const teams = teamsIn(stages);
	const context: Seeding = {
		forSection: pairBrackets(stages, seeding, teams),
		teams,
	};
	view.append(...stages.map((stage) => renderStage(stage, context)));
	return view;
}

function renderStage(stage: StandingsStage, seeding: Seeding): HTMLElement {
	const block = el("section", "t1-stage flex flex-col gap-2.5");
	block.append(el("h3", "t1-stage-title text-xs font-bold tracking-wide text-muted uppercase", stage.name));
	block.append(
		...stage.sections.map((section) => renderSection(section, seeding)),
	);
	return block;
}

function renderSection(
	section: StandingsSection,
	seeding: Seeding,
): HTMLElement {
	const block = el("div", "t1-sec flex flex-col gap-2");
	// A bracket stage often has one section named after the stage itself;
	// repeating it adds a heading and no information.
	if (section.name) block.append(el("h4", "t1-sec-title text-[11.5px] font-semibold", section.name));
	if (section.kind === "group") block.append(renderTable(section.rankings));
	else block.append(...renderBracket(section, seeding));
	return block;
}

/* --- round-robin table ------------------------------------------------ */

function renderTable(rankings: RankingRow[]): HTMLElement {
	const table = el(
		"table",
		"t1-table w-full border-collapse overflow-hidden rounded-lg bg-surface [&>tbody>tr:first-child>td]:border-t-0",
	);

	const head = el("tr");
	head.append(th("#", HEAD), th("Team", HEAD), th("W–L", HEAD_NUM));
	const thead = el("thead");
	thead.append(head);
	table.append(thead);

	const body = el("tbody");
	for (const row of rankings) {
		// Tied teams share an ordinal and a record; give each its own line and
		// repeat the rank, which is how every standings table reads.
		for (const [index, team] of row.teams.entries()) {
			const tr = el("tr", "group data-[t1=true]:bg-accent-soft");
			if (team.isT1) tr.dataset["t1"] = "true";

			tr.append(
				td(index === 0 ? String(row.ordinal) : "", CELL_RANK),
				teamCell(team.code, team.name, team.image),
				td(`${row.wins}–${row.losses}`, CELL_NUM),
			);
			body.append(tr);
		}
	}
	table.append(body);
	return table;
}

function teamCell(code: string, name: string, image: string): HTMLElement {
	// The flex row goes inside the cell, not on it — a display:flex <td> drops
	// out of the table's own layout.
	const inner = el("span", "t1-team-cell flex items-center gap-2");
	inner.append(
		badge(
			image,
			"grid h-5 w-5 flex-none place-items-center rounded-full bg-logo p-px",
			"h-full w-full object-contain",
		),
		el(
			"span",
			"t1-team-name group-data-[t1=true]:font-[650] group-data-[t1=true]:text-accent",
			name || code,
		),
	);

	const cell = el("td", "border-t border-border px-2.5 py-1.5 text-xs");
	cell.append(inner);
	return cell;
}

/* --- bracket ---------------------------------------------------------- */

/**
 * A bracket, and the line above it saying how many teams enter it.
 *
 * Two nodes rather than one wrapper: the count belongs with the section's
 * heading, in the section's own column flow, not inside the horizontal
 * scroller that a seven-column bracket needs.
 */
function renderBracket(
	section: StandingsSection,
	seeding: Seeding,
): HTMLElement[] {
	const index = indexBracket(section);
	const wiki = seeding.forSection.get(section);
	const wrapper = el("div", "t1-bracket overflow-x-auto");
	const grid = el("div", "t1-bracket-grid relative flex items-center gap-[34px]");

	// One SVG behind the whole grid; each line is positioned from the boxes'
	// own geometry once they have been laid out.
	const lines = document.createElementNS(SVG_NS, "svg");
	lines.setAttribute(
		"class",
		"t1-bracket-lines pointer-events-none absolute top-0 left-0 overflow-visible",
	);
	lines.setAttribute("aria-hidden", "true");

	/** structuralId → the element drawn for that match, for the line ends. */
	const boxes = new Map<string, HTMLElement>();

	for (const column of section.columns) {
		const col = el("div", "t1-bracket-col flex flex-col justify-center gap-[18px]");
		for (const round of column.rounds) {
			const group = el("div", "t1-round flex flex-col gap-1.5");
			group.append(el(
					"div",
					"t1-round-name text-[9.5px] font-semibold tracking-wide text-muted uppercase",
					round.name,
				));
			for (const match of round.matches) {
				const box = renderBracketMatch(match, index, wiki);
				if (match.structuralId) boxes.set(match.structuralId, box);
				group.append(box);
			}
			col.append(group);
		}
		grid.append(col);
	}

	// The SVG is positioned from the grid's own origin, so it has to share one:
	// an inner box that shrink-wraps the grid keeps the two aligned however far
	// the bracket is scrolled sideways.
	const inner = el("div", "t1-bracket-inner relative w-max");
	inner.append(lines, grid);
	wrapper.append(inner);

	// Geometry isn't readable until layout has run, and the popup changes width
	// on the way into this view. A ResizeObserver covers both: it fires once the
	// grid has a size, and again whenever that size changes.
	const observer = new ResizeObserver(() =>
		draw({ section, boxes, lines, grid }),
	);
	observer.observe(grid);
	observers.add(observer);

	const above: HTMLElement[] = [];
	if (index.entrants > 0) {
		above.push(
			el(
				"p",
				"t1-bracket-entry text-[10.5px] text-muted",
				index.entrants === 1
					? "1 team enters this bracket"
					: `${index.entrants} teams enter this bracket`,
			),
		);
	}
	// The credit sits under the bracket it applies to, and only under one the
	// wiki actually said something about. Fandom's text is CC BY-SA, and a team
	// borrowed from a second source should say where it came from either way.
	const below = wiki ? [renderCredit(wiki.bracket.page, wiki.fetchedAt)] : [];
	return [...above, wrapper, ...below];
}

function renderCredit(page: string, fetchedAt: number): HTMLElement {
	const line = el("p", "t1-bracket-credit text-[10px] text-muted");
	const link = el(
		"a",
		"t1-credit-link underline decoration-dotted underline-offset-2 hover:text-text",
		"Leaguepedia",
	);
	link.href = `https://lol.fandom.com/wiki/${encodeURI(page.replace(/ /g, "_"))}`;
	link.target = "_blank";
	link.rel = "noreferrer";
	link.title = page;

	// The stamp belongs next to the credit: this is the one thing on screen that
	// came from somewhere else, and how old it is decides whether to trust it.
	line.append(
		el("span", undefined, "Seeding from "),
		link,
		el("span", undefined, `, read ${relative(fetchedAt)}`),
	);
	return line;
}

function renderBracketMatch(
	match: BracketMatch,
	index: BracketIndex,
	wiki: SectionSeeding | undefined,
): HTMLElement {
	const box = el(
		"div",
		"t1-bout w-[152px] overflow-hidden rounded-md bg-surface data-[t1=true]:bg-accent-soft",
	);
	box.dataset["state"] = match.state;

	// A slot the wiki fills with T1 marks the box as T1's, the same as the API
	// naming them would — but only when it is certain, not when T1 is one of two
	// teams that could be there.
	const t1 = match.teams.some((team) => {
		if (team.isT1) return true;
		const fill = fillFor(team, index, wiki);
		return fill?.teams.length === 1 && fill.teams[0]?.isT1 === true;
	});
	if (t1) box.dataset["t1"] = "true";

	for (const team of match.teams) {
		box.append(renderBracketTeam(team, match, index, wiki));
	}
	return box;
}

/** The wiki's answer for one slot, if this is an entry slot and it has one. */
function fillFor(
	team: BracketTeam,
	index: BracketIndex,
	wiki: SectionSeeding | undefined,
): SlotFill | undefined {
	if (!team.tbd || !wiki || team.origin?.kind !== "decisionPoint") return undefined;
	const at = index.entryOrder.get(slotKey(team.origin));
	return at === undefined ? undefined : wiki.fills.get(at);
}

function renderBracketTeam(
	team: BracketTeam,
	match: BracketMatch,
	index: BracketIndex,
	wiki: SectionSeeding | undefined,
): HTMLElement {
	const row = el(
		"div",
		"t1-bout-team group flex items-center gap-[7px] px-2 py-[5px] text-[11.5px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border data-[outcome=loss]:opacity-55",
	);
	if (team.isT1) row.dataset["t1"] = "true";
	if (match.state === "completed") {
		row.dataset["outcome"] = team.won ? "win" : "loss";
	}

	/*
	 * Three kinds of row, in order of how much is known:
	 *
	 *   a team          the API's own, or the one the wiki says must be here
	 *   two teams       the wiki narrowed the slot to a pair; it says which two
	 *   a slot label    nobody knows yet, so it says what will decide it
	 *
	 * Only the first gets a badge. An undecided slot spends that width on the
	 * label instead: the API's placeholder logo is the same grey circle in every
	 * empty slot, sitting exactly where the information goes.
	 */
	const fill = fillFor(team, index, wiki);
	const certain = fill?.teams.length === 1 ? fill.teams[0] : undefined;
	const known = team.tbd ? certain : team;
	const slot = known ? null : slotLabel(team.origin, index, fill);

	if (known) {
		row.append(
			badge(
				known.image,
				"grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-logo p-px",
				"h-full w-full object-contain",
			),
		);
		if (certain) {
			row.dataset["filled"] = "true";
			row.title = `${certain.name} — ${fill?.from} on Leaguepedia`;
		}
		if (known.isT1) row.dataset["t1"] = "true";
	} else if (slot) {
		row.dataset["slot"] = "true";
		row.title = slot.full;
	}

	row.append(
		known
			? el("span", known.isT1 ? BOUT_CODE_T1 : BOUT_CODE, known.code || "TBD")
			: slotText(slot, fill),
		el(
			"span",
			"t1-bout-score flex-none font-bold text-muted tabular-nums group-data-[outcome=win]:text-win",
			match.state === "unstarted" ? "" : String(team.score),
		),
	);
	return row;
}

/**
 * The slot's own line: a pair of codes where the wiki narrowed it to two teams,
 * and otherwise what will decide it.
 *
 * T1 keeps its colour inside a pair — it is the whole reason to read this — but
 * the row is not marked as T1's, because on this evidence it might not be.
 */
function slotText(
	slot: SlotLabel | null,
	fill: SlotFill | undefined,
): HTMLElement {
	if (!fill || fill.teams.length !== 2) {
		return el("span", BOUT_SLOT, slot ? slot.short : "TBD");
	}

	// Each code keeps its own badge, so the pair reads as two teams rather than
	// as one hyphenated name. Smaller than a settled row's badge, which is the
	// difference between "this is the team" and "it is one of these".
	const line = el("span", BOUT_SLOT_PAIR);
	fill.teams.forEach((team, at) => {
		if (at > 0) line.append(el("span", "flex-none opacity-45", "/"));
		line.append(
			badge(
				team.image,
				"grid h-3.5 w-3.5 flex-none place-items-center rounded-full bg-logo p-px",
				"h-full w-full object-contain",
			),
			el("span", team.isT1 ? "text-accent" : undefined, team.code),
		);
	});
	return line;
}

/* --- what an undecided slot says -------------------------------------- */

/** A slot's label: what fits in the box, and what the tooltip spells out. */
interface SlotLabel {
	short: string;
	full: string;
}

/**
 * Where this slot's team will come from, or null when the origin doesn't say.
 *
 * Null is the honest answer for an origin we can't read — a `match` edge whose
 * source sits in a section we didn't draw, or a slot number outside 1–2 — and
 * it leaves the row reading "TBD", which is what it read before.
 */
function slotLabel(
	origin: BracketOrigin | null,
	index: BracketIndex,
	fill: SlotFill | undefined,
): SlotLabel | null {
	if (!origin) return null;

	if (origin.kind === "seeding") {
		if (origin.slot <= 0) return null;
		return {
			short: `Seed ${origin.slot}`,
			full: `Seed ${origin.slot} of this bracket`,
		};
	}

	if (origin.kind === "decisionPoint") {
		if (!index.entryDecisions.has(origin.structuralId)) {
			return {
				short: "Selection",
				full: "Placed by a draw, or by a seed's choice of opponent",
			};
		}

		// The wiki, where it was read and where it lines up, knows which seed
		// this slot is waiting for. Where it doesn't, the slot says only that
		// something earlier decides it — which is all the API said.
		const seed = fill ? seedLabel(fill.seed) : "";
		if (!seed) {
			return { short: "Qualifier", full: "Qualifies out of an earlier stage" };
		}

		// Narrowed to two teams, the row prints both and the tooltip says which
		// seed it was that narrowed it.
		if (fill && fill.teams.length === 2) {
			const [first, second] = fill.teams;
			return {
				short: seed,
				full: `${seed} — ${first?.name} or ${second?.name}`,
			};
		}
		return { short: seed, full: `${seed}, qualifying out of an earlier stage` };
	}

	const round = index.rounds.get(origin.structuralId);
	if (!round || (origin.slot !== 1 && origin.slot !== 2)) return null;

	const side = origin.slot === 1 ? "Winner" : "Loser";
	return { short: `${side} ${abbreviate(round)}`, full: `${side} of ${round}` };
}

/**
 * A wiki seed as the box should read it.
 *
 * The wiki writes a seed three ways and all three turn up in one LCK season:
 * "1 Rise" is the first seed of the Rise group, "5/6" is a bracket seed not yet
 * pinned down, "A1" is a group and a rank already joined up. Only the first
 * needs rearranging, and anything unrecognised is left exactly as written
 * rather than guessed at.
 */
function seedLabel(raw: string): string {
	const text = raw.trim();

	const named = /^(\d+(?:\/\d+)?)\s+(.+)$/.exec(text);
	if (named) return `${named[2]} #${named[1]}`;
	if (/^\d+(?:\/\d+)?$/.test(text)) return `Seed ${text}`;
	return text;
}

/** What a slot label needs that the slot itself can't see. */
interface BracketIndex {
	/** structuralId → the round that match sits in. */
	rounds: Map<string, string>;
	/** The decision points that fill slots in the leftmost column. */
	entryDecisions: Set<string>;
	/**
	 * Each entry slot's position in the bracket, counted in slot order — the
	 * index a wiki seed is read from.
	 */
	entryOrder: Map<string, number>;
	/** How many slots this bracket is entered at from outside. */
	entrants: number;
}

function slotKey(origin: BracketOrigin): string {
	return `${origin.structuralId}#${origin.slot}`;
}

/**
 * Read the whole section once, for the two things one slot can't see.
 *
 * A `decisionPoint` says a slot is filled later but not by whom, and the same
 * field covers two different things: a team qualifying in from an earlier
 * stage, and a team already in this bracket being placed by a draw or by a
 * seed's choice. Which column it first fills separates them — anything in the
 * leftmost column is arriving from outside, because nothing in this bracket has
 * been played yet. That holds for all 19 decision points across the six tracked
 * leagues that have resolved far enough to check: 13 entries, 6 placements, no
 * case that is both.
 */
function indexBracket(section: StandingsSection): BracketIndex {
	const rounds = new Map<string, string>();
	/** Seed numbers, which are entrants wherever they turn up. */
	const seeds = new Set<number>();
	/** Decision point → the column it first fills, and the slots it holds. */
	const decisions = new Map<string, { at: number; slots: Set<number> }>();

	section.columns.forEach((column, at) => {
		for (const round of column.rounds) {
			for (const match of round.matches) {
				if (match.structuralId) rounds.set(match.structuralId, round.name);

				for (const { origin } of match.teams) {
					if (!origin || origin.kind === "match") continue;
					if (origin.kind === "seeding") {
						seeds.add(origin.slot);
						continue;
					}

					const pool = decisions.get(origin.structuralId);
					if (!pool) {
						decisions.set(origin.structuralId, {
							at,
							slots: new Set([origin.slot]),
						});
					} else {
						pool.at = Math.min(pool.at, at);
						pool.slots.add(origin.slot);
					}
				}
			}
		}
	});

	const entryDecisions = new Set<string>();
	const entryOrder = new Map<string, number>();
	let entrants = seeds.size;

	// Sorted, so the nth entry slot is the same n on every render and can be
	// lined up against a list that came from somewhere else entirely. In every
	// bracket the six leagues have served there is exactly one entry pool, so
	// this is slot order; the structuralId only breaks a tie that has not
	// happened yet.
	for (const [structuralId, pool] of [...decisions].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (pool.at !== 0) continue;
		entryDecisions.add(structuralId);
		entrants += pool.slots.size;
		for (const slot of [...pool.slots].sort((a, b) => a - b)) {
			entryOrder.set(`${structuralId}#${slot}`, entryOrder.size);
		}
	}

	return { rounds, entryDecisions, entryOrder, entrants };
}

/* --- the wiki's half -------------------------------------------------- */

/** One entry slot, and the team or teams the wiki puts in it. */
interface SlotFill {
	/** One team means certain; two mean either, and the slot says so. */
	teams: StandingTeam[];
	/** The wiki's own word for this slot's seed, kept for the tooltip. */
	seed: string;
	/** Where a certain team came from: "Legend Group #5". */
	from: string;
}

/** What one bracket section gets from the wiki. */
interface SectionSeeding {
	bracket: WikiBracket;
	/** Entry position → who takes it, for the positions that are settled. */
	fills: Map<number, SlotFill>;
	/** When the read behind it happened, for the line under the bracket. */
	fetchedAt: number;
}

/**
 * Who the wiki puts in each entry slot of one bracket.
 *
 * Both sides of this describe a seed in prose — the bracket's slots as
 * "5 Legend" or "3", the participants as "Legend Group #2/3" — so both are
 * parsed to a group and the ranks they could be, and a slot is filled when
 * exactly one team can take it. A team whose own rank is still a range fits
 * more than one slot, and those slots name both of the teams that could be
 * there rather than pretending to know which.
 */
function fillSlots(
	bracket: WikiBracket,
	teams: Map<string, StandingTeam>,
): Map<number, SlotFill> {
	const slots = bracket.seeds.map((seed) => ({ seed, ref: seedRef(seed) }));
	const entrants = bracket.entrants
		.map((entrant) => ({
			team: teams.get(normalise(entrant.team)),
			ref: seedRef(entrant.seed),
			seed: entrant.seed,
		}))
		.filter((entrant) => entrant.team !== undefined && entrant.ref !== null);

	/*
	 * A bracket that numbers its own seeds — "3", "5/6" — says nothing about
	 * which group they came out of. But when every team named on the page came
	 * out of the same one, those numbers are that group's places: the LCK's
	 * playoff seeds 1–4 are the Legend group's 1–4, and the page's own two lists
	 * allow no other reading. Two groups among the entrants, or a slot that
	 * names its group already, and nothing is implied.
	 */
	const groups = new Set(entrants.map((entrant) => entrant.ref?.group ?? ""));
	const implied =
		groups.size === 1 && slots.every((slot) => slot.ref && !slot.ref.group)
			? ([...groups][0] ?? "")
			: "";

	/** Slot position → every entrant that could be the one in it. */
	const options = new Map<number, typeof entrants>();
	slots.forEach((slot, at) => {
		const ranks = slot.ref?.ranks;
		if (!slot.ref || !ranks) return;

		const group = slot.ref.group || implied;
		options.set(
			at,
			entrants.filter(
				(entrant) =>
					entrant.ref?.group === group &&
					entrant.ref.ranks.some((rank) => ranks.includes(rank)),
			),
		);
	});

	/*
	 * Every slot the wiki named gets an entry, even one no team can be pinned
	 * to: "5/6" is the Rise group's qualifiers, who are not on this page yet,
	 * and the slot still reads better as that than as "Qualifier".
	 */
	const fills = new Map<number, SlotFill>();
	for (const [at, possible] of options) {
		const seed = slots[at]?.seed ?? "";
		const first = possible[0];
		fills.set(at, { teams: [], seed, from: "" });

		// One candidate is only certain if that team fits nowhere else — two
		// slots reading the same seed would otherwise both claim it.
		if (possible.length === 1 && first?.team) {
			const alsoFits = [...options].some(
				([other, list]) => other !== at && list.includes(first),
			);
			if (!alsoFits) {
				fills.set(at, { teams: [first.team], seed, from: first.seed });
				continue;
			}
		}

		// Two, and the slot names both. Three or more and the seed reads better
		// than a list does.
		if (possible.length === 2) {
			const pair = possible
				.map((entrant) => entrant.team)
				.filter((team): team is StandingTeam => team !== undefined);
			if (pair.length === 2) fills.set(at, { teams: pair, seed, from: "" });
		}
	}
	return fills;
}

/** A seed as either side of the wiki writes it. */
interface SeedRef {
	/** The group it came out of, lowercased, or "" for a bare number. */
	group: string;
	/** Every place it could be: [5] for "#5", [2, 3] for "#2/3". */
	ranks: number[];
}

/**
 * "Legend Group #2/3", "5 Legend", "5/6", "A1" → a group and its ranks.
 *
 * One parser for both sides on purpose: the bracket and the participants list
 * are written by the same hands in the same season and rarely the same way, and
 * matching them is only sound if both were read by the same rules.
 */
function seedRef(raw: string): SeedRef | null {
	const text = raw.trim();

	const numbers = /(\d+(?:\/\d+)*)/.exec(text);
	if (!numbers?.[1]) return null;

	const ranks = numbers[1]
		.split("/")
		.map(Number)
		.filter((rank) => Number.isInteger(rank) && rank > 0);
	if (ranks.length === 0) return null;

	// Whatever is left once the number and the words that only say "this is a
	// seed" are gone. For "5/6" and "3" that is nothing, which is the point.
	const group = text
		.replace(numbers[1], " ")
		.replace(/[#()]/g, " ")
		.replace(/\b(?:group|seed|seeds)\b/gi, " ")
		.trim()
		.toLowerCase();

	return { group, ranks };
}

/** What renderStandings works out once, for every section under it. */
interface Seeding {
	/** Which wiki bracket belongs to which section, where that is unambiguous. */
	forSection: Map<StandingsSection, SectionSeeding>;
	/** Normalised code and name → the team, for naming a wiki entrant. */
	teams: Map<string, StandingTeam>;
}

/**
 * Match each wiki bracket to the section it describes, by how many teams enter
 * it — and only where that number picks out exactly one of each.
 *
 * Nothing joins the two sources: no shared id, and names that don't agree
 * ("Regional Championship" against "Season Playoffs"). What they do agree on is
 * arithmetic — the LCK's play-in takes four teams and its playoffs six — and a
 * count that is unique on both sides is a pairing nothing else can explain. Two
 * four-slot brackets in one tournament would be ambiguous, so neither is
 * labelled: a wrong seed on a bracket is worse than no seed at all.
 */
function pairBrackets(
	stages: StandingsStage[],
	seeding: WikiSeeding | null | undefined,
	teams: Map<string, StandingTeam>,
): Map<StandingsSection, SectionSeeding> {
	const pairs = new Map<StandingsSection, SectionSeeding>();
	if (!seeding) return pairs;

	const sections = new Map<number, StandingsSection[]>();
	for (const stage of stages) {
		for (const section of stage.sections) {
			if (section.kind !== "bracket") continue;
			const count = indexBracket(section).entrants;
			if (count === 0) continue;
			push(sections, count, section);
		}
	}

	const brackets = new Map<number, WikiBracket[]>();
	for (const bracket of seeding.brackets) {
		push(brackets, bracket.seeds.length, bracket);
	}

	for (const [count, group] of sections) {
		const candidates = brackets.get(count);
		const section = group[0];
		const bracket = candidates?.[0];
		if (group.length !== 1 || !section) continue;
		if (!candidates || candidates.length !== 1 || !bracket) continue;
		pairs.set(section, {
			bracket,
			fills: fillSlots(bracket, teams),
			fetchedAt: seeding.fetchedAt,
		});
	}
	return pairs;
}

function push<T>(into: Map<number, T[]>, key: number, value: T): void {
	const group = into.get(key);
	if (group) group.push(value);
	else into.set(key, [value]);
}

/**
 * Every team the API named anywhere in this tournament, by code and by name.
 *
 * The wiki writes a team however its editor felt — "GEN", "KT Rolster",
 * "Dplus Kia" — where the API has one code and one name for each. Normalising
 * both sides to letters and digits is enough to join every LCK team; one that
 * doesn't join keeps the wiki's spelling and simply gets no code.
 */
function teamsIn(stages: StandingsStage[]): Map<string, StandingTeam> {
	const teams = new Map<string, StandingTeam>();

	const add = (team: StandingTeam) => {
		for (const key of [team.code, team.name]) {
			const normalised = normalise(key);
			if (normalised) teams.set(normalised, team);
		}
	};

	for (const stage of stages) {
		for (const section of stage.sections) {
			for (const row of section.rankings) row.teams.forEach(add);
			for (const column of section.columns) {
				for (const round of column.rounds) {
					for (const match of round.matches) {
						for (const team of match.teams) if (!team.tbd) add(team);
					}
				}
			}
		}
	}
	return teams;
}

function normalise(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/*
 * Round names, shortened to fit a 152px box. Every one of the 24 distinct names
 * the six leagues use is one or two of these segments — "Lower Bracket - Round
 * 3", "Upper Bracket - Semifinals", "Finals" — and a name that matches none of
 * them passes through whole rather than being mangled into initials.
 */
const ROUND_WORDS: Array<[RegExp, string]> = [
	[/^upper bracket$/, "UB"],
	[/^(?:lower|loser'?s?'?) bracket$/, "LB"],
	[/^winner'?s?'? bracket$/, "WB"],
	[/^round (\d+)$/, "R$1"],
	[/^grand finals?$/, "GF"],
	[/^finals?$/, "F"],
	[/^semifinals?$/, "SF"],
	[/^quarterfinals?$/, "QF"],
];

function abbreviate(round: string): string {
	return round
		.split(/\s+[-–]\s+/)
		.map((segment) => {
			const word = segment.trim().toLowerCase();
			for (const [pattern, short] of ROUND_WORDS) {
				if (pattern.test(word)) return word.replace(pattern, short);
			}
			return segment.trim();
		})
		.filter(Boolean)
		.join(" ");
}

/* --- connectors ------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

/*
 * Class strings used in more than one place, or picked between by a
 * conditional. They are whole literals on purpose — Tailwind reads class names
 * out of this source, so anything assembled at runtime compiles to nothing.
 */
const PLACEHOLDER =
	"t1-placeholder rounded-lg border border-dashed border-border px-3.5 py-5 text-center text-[11.5px] leading-relaxed text-muted";
const HEAD =
	"border-b border-border px-2.5 py-[7px] text-left text-[10px] font-semibold tracking-wide text-muted uppercase";
const HEAD_NUM =
	"t1-num border-b border-border px-2.5 py-[7px] text-right text-[10px] font-semibold tracking-wide text-muted uppercase tabular-nums";
const CELL_NUM = "t1-num border-t border-border px-2.5 py-1.5 text-xs text-right tabular-nums";
const CELL_RANK =
	"t1-rank w-[30px] border-t border-border px-2.5 py-1.5 text-xs text-muted tabular-nums";
const BOUT_CODE = "t1-bout-code min-w-0 flex-1 truncate font-semibold text-muted";
const BOUT_CODE_T1 = "t1-bout-code min-w-0 flex-1 truncate font-semibold text-accent";
/*
 * A slot label has to read as a description and not as a team, in a row where
 * the team codes are already muted — so it steps down a size and goes to caps,
 * and it is the only row in the box with no badge beside it.
 */
const BOUT_SLOT =
	"t1-bout-slot min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wide text-muted uppercase";
/* The same line, laid out for two teams and their badges. */
const BOUT_SLOT_PAIR =
	"t1-bout-slot flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[10px] font-semibold tracking-wide text-muted uppercase";

interface Bracket {
	section: StandingsSection;
	boxes: Map<string, HTMLElement>;
	lines: SVGSVGElement;
	grid: HTMLElement;
}

/**
 * A ResizeObserver holds its target alive, so every bracket's observer is kept
 * here and dropped when the next tournament is drawn. Only one tournament view
 * exists at a time, which is what makes wholesale disposal correct.
 */
const observers = new Set<ResizeObserver>();

function disposeConnectors(): void {
	for (const observer of observers) observer.disconnect();
	observers.clear();
}

function draw(bracket: Bracket): void {
	const { section, boxes, lines, grid } = bracket;
	lines.replaceChildren();

	const frame = grid.getBoundingClientRect();
	if (frame.width === 0) return; // Not laid out yet, or hidden.

	lines.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
	lines.setAttribute("width", String(frame.width));
	lines.setAttribute("height", String(frame.height));

	for (const column of section.columns) {
		for (const round of column.rounds) {
			for (const match of round.matches) {
				const to = boxes.get(match.structuralId);
				if (!to) continue;

				for (const team of match.teams) {
					// A line only exists between two matches: a seed, and a slot
					// something decides later, have nothing to come from.
					const { origin } = team;
					if (origin?.kind !== "match") continue;

					// Nor does a source match sitting in a section we didn't draw.
					const from = boxes.get(origin.structuralId);
					if (!from) continue;

					lines.append(
						connector(from, to, frame, {
							highlight: team.isT1,
							// Slot 2 is the loser — the drop into the lower bracket,
							// which drawn like the winner's path reads as one team
							// advancing twice.
							loser: origin.slot === 2,
						}),
					);
				}
			}
		}
	}
}

/**
 * An elbow from the right edge of `from` to the left edge of `to`, turning
 * halfway across the gap — the shape every bracket uses.
 */
function connector(
	from: HTMLElement,
	to: HTMLElement,
	frame: DOMRect,
	style: { highlight: boolean; loser: boolean },
): SVGPathElement {
	const a = from.getBoundingClientRect();
	const b = to.getBoundingClientRect();

	const x1 = a.right - frame.left;
	const y1 = a.top + a.height / 2 - frame.top;
	const x2 = b.left - frame.left;
	const y2 = b.top + b.height / 2 - frame.top;
	const mid = x1 + (x2 - x1) / 2;

	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", `M${x1} ${y1} H${mid} V${y2} H${x2}`);
	// These are plain classes out of style.css rather than utilities, so
	// assembling the list is safe — there is no Tailwind scan to defeat.
	path.setAttribute(
		"class",
		[
			"t1-line",
			style.highlight ? "t1-line-t1" : "",
			style.loser ? "t1-line-loser" : "",
		]
			.filter(Boolean)
			.join(" "),
	);
	return path;
}

/* --- dom -------------------------------------------------------------- */

/**
 * A logo, or an empty box.
 *
 * No text fallback: every badge here sits directly beside the team's own code
 * or name, so spelling it out again just reads as "BLG BLG" whenever an image
 * fails to load.
 */
function badge(image: string, wrapperClass: string, imgClass: string): HTMLElement {
	const wrapper = el("span", wrapperClass);
	if (!image) return wrapper;

	const img = el("img", imgClass);
	img.src = image;
	img.alt = "";
	img.loading = "lazy";
	img.addEventListener("error", () => img.remove(), { once: true });
	wrapper.append(img);
	return wrapper;
}

function th(text: string, className: string): HTMLElement {
	return el("th", className, text);
}

function td(text: string, className?: string): HTMLElement {
	return el("td", className, text);
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
