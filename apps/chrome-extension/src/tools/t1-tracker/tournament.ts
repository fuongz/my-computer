/**
 * The tournament sub-view: one tournament's stages, stacked.
 *
 * A stage's sections come in two shapes and the API says which — a `group` is a
 * round-robin table, a `bracket` is columns of named rounds. Both are drawn
 * here; the panel only decides when to show them.
 *
 * The bracket's connector lines are real, not inferred: every team past the
 * first round carries `origin.structuralId` naming the match it came from, so
 * the lines are read off the data rather than guessed from the layout. They are
 * drawn as one SVG sized to the grid, from geometry that only exists after
 * layout — hence the ResizeObserver rather than a draw call at build time.
 */

import type {
	BracketMatch,
	BracketTeam,
	RankingRow,
	Standings,
	StandingsSection,
	StandingsStage,
} from "./api";

export function renderStandings(standings: Standings): HTMLElement {
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

	view.append(...stages.map(renderStage));
	return view;
}

function renderStage(stage: StandingsStage): HTMLElement {
	const block = el("section", "t1-stage flex flex-col gap-2.5");
	block.append(el("h3", "t1-stage-title text-xs font-bold tracking-wide text-muted uppercase", stage.name));
	block.append(...stage.sections.map(renderSection));
	return block;
}

function renderSection(section: StandingsSection): HTMLElement {
	const block = el("div", "t1-sec flex flex-col gap-2");
	// A bracket stage often has one section named after the stage itself;
	// repeating it adds a heading and no information.
	if (section.name) block.append(el("h4", "t1-sec-title text-[11.5px] font-semibold", section.name));
	block.append(
		section.kind === "group"
			? renderTable(section.rankings)
			: renderBracket(section),
	);
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

function renderBracket(section: StandingsSection): HTMLElement {
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
				const box = renderBracketMatch(match);
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

	return wrapper;
}

function renderBracketMatch(match: BracketMatch): HTMLElement {
	const box = el(
		"div",
		"t1-bout w-[152px] overflow-hidden rounded-md bg-surface data-[t1=true]:bg-accent-soft",
	);
	box.dataset["state"] = match.state;
	if (match.teams.some((team) => team.isT1)) box.dataset["t1"] = "true";

	for (const team of match.teams) box.append(renderBracketTeam(team, match));
	return box;
}

function renderBracketTeam(team: BracketTeam, match: BracketMatch): HTMLElement {
	const row = el(
		"div",
		"t1-bout-team group flex items-center gap-[7px] px-2 py-[5px] text-[11.5px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border data-[outcome=loss]:opacity-55",
	);
	if (team.isT1) row.dataset["t1"] = "true";
	if (match.state === "completed") {
		row.dataset["outcome"] = team.won ? "win" : "loss";
	}

	row.append(
		badge(
			team.image,
			"grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-logo p-px",
			"h-full w-full object-contain",
		),
		el(
			"span",
			team.isT1 ? BOUT_CODE_T1 : BOUT_CODE,
			team.code || "TBD",
		),
		el(
			"span",
			"t1-bout-score flex-none font-bold text-muted tabular-nums group-data-[outcome=win]:text-win",
			match.state === "unstarted" ? "" : String(team.score),
		),
	);
	return row;
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
					const from = team.fromMatch ? boxes.get(team.fromMatch) : undefined;
					// No line for a seeded team, nor for one whose source match sits
					// in a section we didn't draw.
					if (!from) continue;
					lines.append(connector(from, to, frame, team.isT1));
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
	highlight: boolean,
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
	path.setAttribute("class", highlight ? "t1-line t1-line-t1" : "t1-line");
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
