/**
 * The tool's detail view: a form, and what comes back when you press it.
 *
 * One screen. Province, draw date and the six digits on the ticket go across
 * the top; underneath, the verdict, the ticket with its winning tail marked,
 * and the whole draw so the answer can be checked against the numbers it came
 * from.
 *
 * The verdict is the part that is allowed to be loud. A win gets green, a burst
 * of confetti and the total in full; a miss gets a clover and the sentence you
 * would want to read, which is not a shrug. Everything under it stays quiet, so
 * the celebration is one object rather than a mood over the whole panel.
 *
 * Nothing here reaches the network until the form is valid: a province only
 * draws on its own weekdays, and asking xskt.com.vn for any other day gets a
 * confidently wrong answer (see api.ts). The weekday is checked from the table
 * in provinces.ts first, so a wrong date is answered instantly and for free.
 *
 * Written in Vietnamese, unlike the rest of the popup: the prizes and the
 * provinces have no English names worth inventing, and half the panel would
 * have been Vietnamese regardless.
 *
 * Built with local helpers rather than the popup's, so the tool stays
 * self-contained under src/tools/. Styling is Tailwind utilities; the bare
 * `xs-*` names next to them are the hooks scripts/preview-popup.ts addresses,
 * and carry no styles — except the four animations in popup/style.css, which
 * are keyframes a utility cannot state.
 */

import { button } from "../../common/ui";
import { type Draw, drawUrl, getDraw } from "./api";
import { picker } from "./picker";
import {
	drawDayNames,
	drawsOn,
	getProvince,
	lastDrawOnOrBefore,
	PROVINCES,
	REGION_NAMES,
	WEEKDAYS,
	type Region,
} from "./provinces";
import {
	formatDong,
	isTicket,
	matchedLength,
	PRIZE_TIERS,
	score,
	TICKET_LENGTH,
	type Score,
} from "./prizes";
import { Ticket01Icon } from "@hugeicons/core-free-icons";

/*
 * Class strings shared between call sites, or picked between by a conditional.
 * Every one is a whole literal: Tailwind reads class names out of this source,
 * so anything assembled at runtime compiles to no CSS at all.
 */
const PANEL = "xs flex flex-col gap-3.5";
const LABEL =
	"xs-label mb-[7px] block text-[11px] font-semibold tracking-wide text-muted uppercase";
const CONTROL =
	"xs-control h-[38px] w-full rounded-[11px] border border-border bg-surface px-2.5 text-[13px] text-text shadow-rest transition focus:outline-2 focus:-outline-offset-1 focus:outline-accent";
const TICKET_INPUT =
	"xs-control xs-ticket-input h-[38px] w-full rounded-[11px] border border-border bg-surface px-2.5 text-center text-[15px] font-bold tracking-[0.3em] text-text tabular-nums shadow-rest transition focus:outline-2 focus:-outline-offset-1 focus:outline-accent";
const PLACEHOLDER =
	"xs-placeholder rounded-lg border border-dashed border-border px-3.5 py-5 text-center text-[11.5px] leading-relaxed text-muted";
const NOTE_HINT = "xs-note text-[11px] leading-snug text-muted";
const NOTE_WARN = "xs-note xs-note-warn text-[11px] leading-snug text-warn";
/*
 * A number the ticket took. Amber rather than the verdict's green, because it
 * is a highlighter over a printed sheet — the same mark xskt.com.vn puts on the
 * rows you won.
 */
/*
 * The draw is a ruled table, the way the printed sheet is: every cell bordered,
 * every number centred in its row.
 */
const TABLE = "xs-draw-table w-full border-collapse text-center";
const CELL_LABEL =
	"xs-draw-label w-[52px] border border-border px-2 py-1.5 text-[11px] font-bold text-muted";
const CELL_NUMBERS = "xs-draw-cell border border-border px-3 py-1.5";

/*
 * The numbers themselves. Each carries a border so a marked one is the same
 * size as an unmarked one — the dashed near-miss outline cannot be a `ring-*`,
 * which has no dashed form, and a border on that one alone would shift the row.
 *
 * The đặc biệt and giải tám are set larger and in red, as the source table sets
 * them: they are the two numbers everyone reads first — the top prize, and the
 * two digits that decide the most tickets.
 */
const CHIP =
	"xs-chip rounded-md border border-transparent px-2 py-0.5 text-[13px] font-semibold text-text tabular-nums";
const CHIP_HIT =
	"xs-chip xs-chip-hit rounded-md border border-warn/40 bg-warn/15 px-2 py-0.5 text-[13px] font-bold text-warn tabular-nums";
const CHIP_BIG =
	"xs-chip xs-chip-big rounded-md border border-transparent px-2 py-0.5 text-[19px] font-bold text-loss tabular-nums";
const CHIP_BIG_HIT =
	"xs-chip xs-chip-hit xs-chip-big rounded-md border border-warn/40 bg-warn/15 px-2 py-0.5 text-[19px] font-bold text-warn tabular-nums";
/** The đặc biệt when the ticket came within one digit of it. */
const CHIP_NEAR =
	"xs-chip xs-chip-near xs-chip-big rounded-md border border-dashed border-warn/55 px-2 py-0.5 text-[19px] font-bold text-loss tabular-nums";
/*
 * The tiles sit inside the verdict card, so they carry their own surface: a
 * sunken tint would be a slightly darker green on the winning card and
 * invisible on the losing one.
 */
const DIGIT =
	"xs-digit grid h-9 w-8 place-items-center rounded-lg border border-border bg-surface text-[17px] font-bold text-muted tabular-nums";
const DIGIT_HIT =
	"xs-digit xs-digit-hit grid h-9 w-8 place-items-center rounded-lg border border-warn/40 bg-warn/15 text-[17px] font-bold text-warn tabular-nums";

/** The palette's four hues, which is all the confetti is allowed to use. */
const CONFETTI_COLORS = [
	"var(--win)",
	"var(--warn)",
	"var(--btn)",
	"var(--live)",
];

/**
 * Guards against a slow fetch painting into a panel the user has already left
 * or switched off. Every render claims a token; only the newest one may draw.
 */
let renderToken = 0;

/**
 * What the form is set to, kept across renders so switching the tool off and
 * on again does not wipe what was typed.
 */
const form = {
	slug: PROVINCES[0]?.slug ?? "",
	date: "",
	ticket: "",
};

export function renderLotteryPanel(host: HTMLElement, enabled: boolean): void {
	const token = ++renderToken;

	if (!enabled) {
		host.replaceChildren(placeholder("Bật tool này để dò vé số."));
		return;
	}

	if (!form.date) form.date = defaultDate(form.slug);

	const panel = el("div", PANEL);
	const result = el("div", "xs-result");
	panel.append(renderForm(token, result), result);
	host.replaceChildren(panel);
}

/* --- the form --------------------------------------------------------- */

function renderForm(token: number, result: HTMLElement): HTMLElement {
	const fields = el(
		"div",
		"xs-form grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] items-end gap-2.5",
	);

	const date = dateInput();
	const ticket = ticketInput();
	const submit = button("Dò vé", { icon: Ticket01Icon });
	submit.type = "submit";
	submit.classList.add("xs-submit");

	const note = el("p", NOTE_HINT);

	/** Re-check the three fields together and say what is still missing. */
	const validate = (): boolean => {
		const problem = check(form);
		submit.disabled = problem !== null;
		note.className = problem?.warn ? NOTE_WARN : NOTE_HINT;
		note.textContent = problem
			? problem.message
			: `${provinceName(form.slug)} · ${describeDate(form.date)}`;
		return problem === null;
	};

	const province = provincePicker((slug) => {
		form.slug = slug;
		// The province is the stronger choice: pick Hậu Giang on a Sunday and
		// the date moves to the Saturday it actually drew, rather than the panel
		// arguing with a date the user did not choose.
		const chosen = getProvince(form.slug);
		if (chosen && !drawsOn(chosen, parseDate(form.date))) {
			form.date = defaultDate(form.slug);
			date.value = form.date;
		}
		validate();
	});

	date.addEventListener("change", () => {
		form.date = date.value;
		validate();
	});

	ticket.addEventListener("input", () => {
		// Digits only, six of them: paste a ticket with spaces in it and this is
		// what makes that work.
		ticket.value = ticket.value.replace(/\D/g, "").slice(0, TICKET_LENGTH);
		form.ticket = ticket.value;
		validate();
	});

	fields.append(
		// The picker is a wrapper around its own trigger, so the label has to be
		// pointed at the button inside it rather than at what was passed here.
		field("Tỉnh/Thành phố", province, "xs-province"),
		field("Ngày xổ", date),
		field("Số vé", ticket),
		submit,
	);

	const wrapper = el("form", "xs-form-card flex flex-col gap-2");
	wrapper.append(fields, note);
	wrapper.addEventListener("submit", (event) => {
		event.preventDefault();
		if (validate()) void lookUp(token, result);
	});

	validate();
	return wrapper;
}

function field(
	label: string,
	control: HTMLElement,
	htmlFor = control.id,
): HTMLElement {
	const block = el("div", "xs-field min-w-0");
	const text = el("label", LABEL, label);
	text.htmlFor = htmlFor;
	block.append(text, control);
	return block;
}

/**
 * Thirty-five provinces, searchable — see ./picker.ts for why this is not a
 * <select>. The slug rides along as a keyword so "xshg" finds Hậu Giang.
 */
function provincePicker(onChange: (slug: string) => void): HTMLElement {
	return picker({
		id: "xs-province",
		ariaLabel: "Tỉnh/Thành phố",
		placeholder: "Tìm tỉnh/thành phố…",
		value: form.slug,
		groups: (["mn", "mt"] as Region[]).map((region) => ({
			label: REGION_NAMES[region],
			items: PROVINCES.filter((province) => province.region === region).map(
				(province) => ({
					value: province.slug,
					label: province.name,
					keywords: province.slug,
				}),
			),
		})),
		onChange,
	}).element;
}

function dateInput(): HTMLInputElement {
	const input = el("input", CONTROL);
	input.id = "xs-date";
	input.type = "date";
	input.value = form.date;
	// A draw that has not happened has no result to look up.
	input.max = isoDate(new Date());
	return input;
}

function ticketInput(): HTMLInputElement {
	const input = el("input", TICKET_INPUT);
	input.id = "xs-ticket";
	input.type = "text";
	input.inputMode = "numeric";
	input.autocomplete = "off";
	input.maxLength = TICKET_LENGTH;
	input.placeholder = "000000";
	input.value = form.ticket;
	return input;
}

/** What is stopping the form from being submitted, or null when nothing is. */
function check(state: typeof form): { message: string; warn: boolean } | null {
	const province = getProvince(state.slug);
	if (!province) return { message: "Chọn tỉnh/thành phố.", warn: false };

	const date = parseDate(state.date);
	if (Number.isNaN(date.getTime())) {
		return { message: "Chọn ngày xổ.", warn: false };
	}
	if (date > endOfToday()) {
		return { message: "Ngày này chưa xổ.", warn: true };
	}
	if (!drawsOn(province, date)) {
		return {
			message: `${province.name} chỉ xổ ${drawDayNames(province)} — ngày bạn chọn là ${WEEKDAYS[date.getDay()]}.`,
			warn: true,
		};
	}
	if (!isTicket(state.ticket)) {
		return {
			message: `Nhập ${TICKET_LENGTH} chữ số trên vé để dò.`,
			warn: false,
		};
	}

	return null;
}

/* --- looking it up ---------------------------------------------------- */

async function lookUp(token: number, result: HTMLElement): Promise<void> {
	result.replaceChildren(placeholder("Đang dò vé…"));

	let draw: Draw | null;
	try {
		draw = await getDraw(form.slug, form.date);
	} catch {
		if (token !== renderToken) return;
		result.replaceChildren(
			placeholder("Không kết nối được xskt.com.vn. Thử lại sau nhé."),
		);
		return;
	}
	if (token !== renderToken) return;

	if (!draw) {
		result.replaceChildren(
			placeholder(
				`Chưa có kết quả ${provinceName(form.slug)} ngày ${vnDate(form.date)}. Kết quả thường có sau 16h30.`,
			),
		);
		return;
	}

	paintResult(result, draw, form.ticket);
}

function paintResult(host: HTMLElement, draw: Draw, ticket: string): void {
	const outcome = score(ticket, draw.numbers);
	const view = el("div", "xs-outcome flex flex-col gap-3.5");
	view.dataset["won"] = String(outcome.hits.length > 0);
	view.append(verdict(outcome, ticket), drawTable(draw, ticket, outcome));
	host.replaceChildren(view);
}

/* --- the verdict ------------------------------------------------------ */

/**
 * The answer, with the ticket inside it.
 *
 * The digits belong in this card rather than beside it: the celebration is
 * about that ticket, and a row floating underneath made two half-empty objects
 * out of one.
 */
function verdict(outcome: Score, ticket: string): HTMLElement {
	return outcome.hits.length > 0
		? wonCard(outcome, ticket)
		: missedCard(ticket);
}

function wonCard(outcome: Score, ticket: string): HTMLElement {
	const card = el(
		"div",
		"xs-verdict xs-verdict-won xs-pop relative overflow-hidden rounded-xl border border-win/30 bg-win/10 px-4 py-4 text-center",
	);
	card.append(confetti());

	const body = el("div", "relative flex flex-col items-center gap-1.5");
	body.append(
		el("div", "xs-emoji text-[30px] leading-none", "🎉"),
		el(
			"p",
			"xs-headline text-[15px] font-bold tracking-tight text-win",
			"XIN CHÚC MỪNG!",
		),
		el(
			"p",
			"xs-verdict-line text-[12px] text-text",
			`Vé số của bạn đã trúng ${listNames(outcome)}!`,
		),
		el(
			"p",
			"xs-total text-[30px] leading-tight font-bold tracking-tight text-win tabular-nums",
			`${formatDong(outcome.total)} ₫`,
		),
	);

	// The breakdown only earns its place when there is more than one prize —
	// with one, it repeats the sentence directly above it.
	if (outcome.hits.length > 1) {
		const list = el("div", "xs-hits flex flex-wrap justify-center gap-1.5");
		for (const hit of outcome.hits) {
			const chip = el(
				"span",
				"xs-hit flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-text shadow-rest",
			);
			chip.append(
				el("span", undefined, hit.name),
				el("span", "text-muted tabular-nums", formatDong(hit.amount)),
			);
			list.append(chip);
		}
		body.append(list);
	}

	// Last, under whatever explained the win: the ticket it happened to.
	body.append(ticketRow(ticket, outcome));

	card.append(body);
	return card;
}

function missedCard(ticket: string): HTMLElement {
	const card = el(
		"div",
		"xs-verdict xs-verdict-missed xs-pop flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-4 py-4 text-center shadow-rest",
	);
	card.append(
		el("div", "xs-emoji xs-bob text-[30px] leading-none", "🍀"),
		el(
			"p",
			"xs-headline text-[15px] font-bold tracking-tight text-text",
			"Rất tiếc :(",
		),
		el(
			"p",
			"xs-verdict-line text-[12px] leading-relaxed text-muted",
			"Vé số của bạn không trúng thưởng, chúc bạn may mắn lần sau!",
		),
		ticketRow(ticket, { hits: [], total: 0, special: "none" }),
	);
	return card;
}

/** "Giải Tám", or "Giải Sáu và Giải Tám" when a ticket took more than one. */
function listNames(outcome: Score): string {
	const names = outcome.hits.map((hit) => hit.name);
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}

function confetti(): HTMLElement {
	const layer = el(
		"div",
		"xs-confetti pointer-events-none absolute inset-0 overflow-hidden",
	);
	layer.setAttribute("aria-hidden", "true");

	for (let index = 0; index < 16; index++) {
		const piece = el("span", "xs-confetti-piece");
		// Spread across the card and staggered, but fixed rather than random:
		// the same win should look the same twice.
		piece.style.left = `${4 + index * 6}%`;
		piece.style.animationDelay = `${(index % 6) * 0.09}s`;
		piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length] ?? "";
		piece.style.transform = `rotate(${index * 37}deg)`;
		layer.append(piece);
	}

	return layer;
}

/* --- the ticket ------------------------------------------------------- */

/** The six digits as tiles, with the tail that won them marked. */
function ticketRow(ticket: string, outcome: Score): HTMLElement {
	const row = el(
		"div",
		"xs-ticket mt-1 flex flex-col items-center gap-1.5",
	);

	const digits = el("div", "xs-digits flex gap-1.5");
	// The longest prize the ticket took is the tail worth marking: win giải sáu
	// and giải tám at once and the four digits of the sáu cover both.
	const tail = matchedLength(outcome.hits);
	const from = ticket.length - tail;
	for (let index = 0; index < ticket.length; index++) {
		const marked = tail > 0 && index >= from;
		digits.append(el("span", marked ? DIGIT_HIT : DIGIT, ticket[index] ?? ""));
	}
	row.append(digits);

	if (outcome.special === "phu-db" || outcome.special === "kk") {
		row.append(
			el(
				"span",
				"xs-near text-[11px] text-muted",
				outcome.special === "phu-db"
					? "Sai đúng số đầu của giải đặc biệt"
					: "Sai đúng một số của giải đặc biệt",
			),
		);
	}

	return row;
}

/* --- the draw --------------------------------------------------------- */

function drawTable(draw: Draw, ticket: string, outcome: Score): HTMLElement {
	const block = el(
		"div",
		"xs-draw overflow-hidden rounded-lg border border-transparent bg-surface shadow-rest",
	);

	const head = el(
		"div",
		"xs-draw-head flex items-center justify-between gap-3 border-b border-border bg-sunken px-3 py-2",
	);
	head.append(
		el(
			"h3",
			"xs-draw-title text-[11px] font-semibold tracking-wide text-muted uppercase",
			`Kết quả ${abbreviation(draw.slug)} · ${describeDate(draw.date)}`,
		),
	);

	const source = el("a", "xs-source text-[10.5px] text-muted underline", "xskt.com.vn");
	source.href = drawUrl(draw.slug, draw.date);
	source.target = "_blank";
	source.rel = "noreferrer";
	head.append(source);
	block.append(head);

	// Only the đặc biệt can be "so close"; every other row is hit or it is not.
	const near = outcome.special === "phu-db" || outcome.special === "kk";

	const table = el("table", TABLE);
	const body = el("tbody");

	for (const tier of PRIZE_TIERS) {
		const numbers = draw.numbers[tier.code] ?? [];
		// The top prize and the two digits that decide the most tickets.
		const big = tier.code === "db" || tier.code === "g8";

		const row = el("tr", "xs-draw-row");
		row.dataset["prize"] = tier.code;

		const label = el("th", CELL_LABEL, tier.label);
		label.scope = "row";
		label.title = tier.name;

		const cell = el("td", CELL_NUMBERS);
		const chips = el(
			"div",
			"xs-draw-numbers flex flex-wrap items-center justify-center gap-x-4 gap-y-1",
		);
		if (numbers.length === 0) chips.append(el("span", CHIP, "—"));

		for (const number of numbers) {
			const hit = number.length <= ticket.length && ticket.endsWith(number);
			chips.append(el("span", chipClass(big, hit, near && tier.code === "db"), number));
		}

		cell.append(chips);
		row.append(label, cell);
		body.append(row);
	}

	table.append(body);
	block.append(table);
	return block;
}

/** One of the five whole class strings a number can be drawn with. */
function chipClass(big: boolean, hit: boolean, near: boolean): string {
	if (hit) return big ? CHIP_BIG_HIT : CHIP_HIT;
	if (near) return CHIP_NEAR;
	return big ? CHIP_BIG : CHIP;
}

/* --- dates ------------------------------------------------------------ */

/** The province's most recent draw day, as `YYYY-MM-DD`. */
function defaultDate(slug: string): string {
	const province = getProvince(slug);
	const today = new Date();
	return isoDate(province ? lastDrawOnOrBefore(province, today) : today);
}

/**
 * `YYYY-MM-DD` in the browser's own timezone.
 *
 * Not toISOString(): that is UTC, and an evening in Vietnam is already the next
 * day there — which would default the panel to a draw that has not happened.
 */
function isoDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of a `YYYY-MM-DD`, so weekdays read in the user's own clock. */
function parseDate(value: string): Date {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return new Date(Number.NaN);
	return new Date(year, month - 1, day);
}

function endOfToday(): Date {
	const today = new Date();
	today.setHours(23, 59, 59, 999);
	return today;
}

/** "15/08/2026". */
function vnDate(value: string): string {
	const [year, month, day] = value.split("-");
	return `${day}/${month}/${year}`;
}

/** "Thứ Bảy 15/08/2026". */
function describeDate(value: string): string {
	const date = parseDate(value);
	if (Number.isNaN(date.getTime())) return "";
	return `${WEEKDAYS[date.getDay()]} ${vnDate(value)}`;
}

/* --- names ------------------------------------------------------------ */

function provinceName(slug: string): string {
	return getProvince(slug)?.name ?? "";
}

/** "xshcm-xstp" → "XSHCM": the code the result page prints above the table. */
function abbreviation(slug: string): string {
	return (slug.split("-")[0] ?? slug).toUpperCase();
}

/* --- dom -------------------------------------------------------------- */

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
