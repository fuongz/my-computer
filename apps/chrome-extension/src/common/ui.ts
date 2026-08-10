/**
 * The popup's shared components.
 *
 * Four shapes, each matching a supplied reference. Three of them stand our
 * accent in for the reference's blue; the button keeps its lime action colour,
 * which is why that hue exists in the palette at all. They return elements
 * rather than markup, because that is how the rest of this popup is built.
 *
 * They live in common/ rather than popup/ for the same reason icons.ts does:
 * the T1 panel draws with them too, and a tool reaching into popup/ would
 * invert the dependency the panel contract deliberately keeps one-way. No
 * content script imports either file.
 *
 * Tailwind reads class names out of this source, so every string here is whole.
 * A variant picks between complete literals; nothing is assembled at runtime.
 */

import { renderIcon, type IconData } from "./icons";

/* --- button ----------------------------------------------------------- */

/**
 * Four faces of one object. `ghost` is the quiet member — the ways back — and
 * carries the family's geometry, hover tint and focus ring without the fill.
 */
export type ButtonVariant = "primary" | "secondary" | "soft" | "danger" | "ghost";

/*
 * Unlike everything else in this file, a button is not a utility string: its
 * face is a gradient over six shadows, and that recipe lives as .btn in
 * popup/style.css so all of it stays one definition. What is left here is the
 * DOM the recipe expects.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
	primary: "btn-primary",
	secondary: "btn-secondary",
	soft: "btn-soft",
	danger: "btn-danger",
	ghost: "btn-ghost",
};

export interface ButtonOptions {
	variant?: ButtonVariant;
	/** Drawn before the label, on the face itself. */
	icon?: IconData;
	/**
	 * The reference's divided trailing section, for a button that opens
	 * something further. Decorative: the whole button is one action, so the
	 * caret says "there is more here", not "click this half".
	 */
	caret?: IconData;
	/** Square and label-less; the label becomes the accessible name. */
	iconOnly?: boolean;
	/** Fills its container, as the content-script dialog's buttons do. */
	block?: boolean;
	onClick?: () => void;
}

export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
	const node = document.createElement("button");
	node.type = "button";
	node.className = [
		"btn",
		BUTTON_VARIANTS[options.variant ?? "primary"],
		...(options.iconOnly ? ["btn-icon"] : []),
		...(options.block ? ["btn-block"] : []),
	].join(" ");

	if (options.iconOnly) {
		// No visible label, so the name has to come from somewhere: the
		// accessible one for a screen reader, the tooltip for everyone else.
		node.setAttribute("aria-label", label);
		node.title = label;
		if (options.icon) node.append(renderIcon(options.icon, "h-4 w-4"));
	} else {
		if (options.icon) node.append(renderIcon(options.icon, ""));
		node.append(text("span", undefined, label));
	}

	if (options.caret) {
		const trailing = text("span", "btn-caret");
		trailing.setAttribute("aria-hidden", "true");
		trailing.append(renderIcon(options.caret, ""));
		node.append(trailing);
	}

	if (options.onClick) node.addEventListener("click", options.onClick);

	return node;
}


/* --- segmented control ------------------------------------------------ */

const SEGMENTED_TRACK = "segmented flex gap-1 rounded-lg bg-sunken p-1";

/*
 * The selected item is a raised chip on a sunken track, not a filled pill —
 * so "selected" reads as nearer rather than as inverted.
 */
const SEGMENT =
	"segment relative grid flex-1 cursor-pointer place-items-center rounded-md px-2.5 py-1.5 text-xs text-muted transition select-none hover:text-text has-[:checked]:bg-surface has-[:checked]:font-semibold has-[:checked]:text-text has-[:checked]:shadow-rest has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent";

export interface SegmentOption {
	value: string;
	label: string;
	/** With an icon the label becomes screen-reader text. */
	icon?: IconData;
}

export function segmented(options: {
	name: string;
	ariaLabel: string;
	items: readonly SegmentOption[];
	value: string;
	onChange: (value: string) => void;
}): HTMLDivElement {
	const track = document.createElement("div");
	track.className = SEGMENTED_TRACK;
	track.setAttribute("role", "radiogroup");
	track.setAttribute("aria-label", options.ariaLabel);

	for (const item of options.items) {
		const wrapper = document.createElement("label");
		wrapper.className = SEGMENT;
		wrapper.dataset["value"] = item.value;
		if (item.icon) wrapper.title = item.label;

		const input = document.createElement("input");
		input.className = "absolute h-0 w-0 opacity-0";
		input.type = "radio";
		input.name = options.name;
		input.value = item.value;
		input.checked = item.value === options.value;
		input.addEventListener("change", () => {
			if (input.checked) options.onChange(item.value);
		});

		wrapper.append(input);
		if (item.icon) wrapper.append(renderIcon(item.icon, "h-[15px] w-[15px]"));
		wrapper.append(text("span", item.icon ? "sr-only" : undefined, item.label));
		track.append(wrapper);
	}

	return track;
}

/* --- switch ----------------------------------------------------------- */

/*
 * Track and knob are siblings of the input on purpose: `peer-*` only reaches
 * forward across siblings, so nesting the dot inside the knob would put it out
 * of range of the checked state. Both move by the same 18px instead.
 */
const SWITCH_TRACK =
	"switch-track block h-[26px] w-11 rounded-full bg-track transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent";
const SWITCH_THUMB =
	"switch-thumb pointer-events-none absolute top-0.5 left-0.5 h-[22px] w-[22px] rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.28)] transition peer-checked:translate-x-[18px] peer-checked:bg-on-accent";
/** The ring's middle: the knob is a donut, which is what the reference draws. */
const SWITCH_DOT =
	"switch-dot pointer-events-none absolute top-[9px] left-[9px] h-2 w-2 rounded-full bg-track transition peer-checked:translate-x-[18px] peer-checked:bg-accent";

export function switchControl(options: {
	id: string;
	ariaLabel: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}): HTMLLabelElement {
	const label = document.createElement("label");
	label.className = "switch relative inline-flex flex-none cursor-pointer";
	label.htmlFor = options.id;

	const input = document.createElement("input");
	input.className = "switch-input peer absolute h-0 w-0 opacity-0";
	input.type = "checkbox";
	input.id = options.id;
	input.setAttribute("role", "switch");
	input.setAttribute("aria-label", options.ariaLabel);
	input.checked = options.checked;
	input.addEventListener("change", () => options.onChange(input.checked));

	const track = text("span", SWITCH_TRACK);
	track.setAttribute("aria-hidden", "true");
	const thumb = text("span", SWITCH_THUMB);
	thumb.setAttribute("aria-hidden", "true");
	const dot = text("span", SWITCH_DOT);
	dot.setAttribute("aria-hidden", "true");

	label.append(input, track, thumb, dot);
	return label;
}

/* --- menu ------------------------------------------------------------- */

/*
 * One container, flat rows, hairline dividers — a list reads as a list. The
 * container is the card; nothing inside it lifts, because raising one row out
 * of a divided stack breaks the rules either side of it.
 */
const MENU = "menu overflow-hidden rounded-lg border border-transparent bg-surface shadow-rest";
const MENU_ROW =
	"menu-row flex items-center gap-3 px-3 py-2.5 transition-colors [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border";
const MENU_ROW_OPENABLE =
	"menu-open flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
/** A rounded square, as the reference's avatars are — not a circle. */
export const MENU_CHIP =
	"menu-chip grid h-8 w-8 flex-none place-items-center rounded-md bg-accent-soft text-muted";

export interface MenuRow {
	/** Set as `data-row-id`, for tests and for finding a row again. */
	id?: string;
	/** Extra classes on the row, for callers that need their own hook. */
	className?: string;
	chip?: HTMLElement | SVGElement;
	title: string;
	subtitle?: string;
	/** A switch, a chevron — whatever sits at the end of the row. */
	trailing?: HTMLElement;
	/** Makes the chip-and-text block a button. */
	onOpen?: () => void;
	openLabel?: string;
	/** Drawn faded, the way the reference dims a finished row. */
	dimmed?: boolean;
}

export function menu(rows: readonly MenuRow[]): HTMLUListElement {
	const list = document.createElement("ul");
	list.className = MENU;
	list.append(...rows.map(menuRow));
	return list;
}

function menuRow(row: MenuRow): HTMLLIElement {
	const item = document.createElement("li");
	item.className = row.className ? `${MENU_ROW} ${row.className}` : MENU_ROW;
	if (row.id) item.dataset["rowId"] = row.id;
	item.dataset["dimmed"] = String(row.dimmed === true);

	const label = text("div", "menu-text flex min-w-0 flex-1 flex-col gap-px");
	label.append(text("span", "menu-title text-[13px] font-semibold", row.title));
	if (row.subtitle) {
		label.append(
			text("span", "menu-subtitle text-[11px] leading-snug text-muted", row.subtitle),
		);
	}

	if (row.onOpen) {
		const open = document.createElement("button");
		open.type = "button";
		open.className = MENU_ROW_OPENABLE;
		open.setAttribute("aria-label", row.openLabel ?? row.title);
		open.addEventListener("click", row.onOpen);
		if (row.chip) open.append(row.chip);
		open.append(label);
		item.append(open);
	} else {
		if (row.chip) item.append(row.chip);
		item.append(label);
	}

	if (row.trailing) item.append(row.trailing);
	return item;
}

/* --- shared ----------------------------------------------------------- */

function text<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	content?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (content !== undefined) node.textContent = content;
	return node;
}
