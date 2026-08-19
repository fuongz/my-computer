/**
 * The province picker: a searchable list rather than a dropdown.
 *
 * Thirty-five provinces in a native <select> is a scroll, and the one you want
 * is one you can name — so this opens a command-palette instead: type a few
 * letters, arrow to it, Enter. Search is diacritic-blind and also reads the
 * site's own slugs, so "hau giang", "haugiang" and "xshg" all land on Hậu
 * Giang, and "hcm" lands on Hồ Chí Minh without a ề in sight.
 *
 * It lives in this tool rather than in common/ui.ts because it is the only
 * place with a list long enough to need it. Move it up the moment a second one
 * appears; nothing here knows what a province is beyond the shape below.
 */

import {
	ArrowDown01Icon,
	Search01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";

import { renderIcon } from "../../common/icons";

export interface PickerItem {
	value: string;
	label: string;
	/** Extra text search should match — a slug, a code, an old name. */
	keywords?: string;
}

export interface PickerGroup {
	label: string;
	items: readonly PickerItem[];
}

export interface PickerOptions {
	id: string;
	/** Names the trigger for a screen reader; not drawn. */
	ariaLabel: string;
	placeholder: string;
	groups: readonly PickerGroup[];
	value: string;
	onChange: (value: string) => void;
}

/*
 * Whole literals, as everywhere else in this popup: Tailwind reads class names
 * out of this source, so a name assembled at runtime compiles to nothing.
 */
const TRIGGER =
	"xs-picker-trigger flex h-[38px] w-full items-center gap-2 rounded-[11px] border border-border bg-surface px-2.5 text-left text-[13px] text-text shadow-rest transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent";
/*
 * Fixed, not absolute: the detail view is a scroll container, and a scroll
 * container clips an absolutely positioned descendant — which cut the list off
 * two rows down. A fixed element's containing block is the viewport, so it
 * escapes that; the cost is placing it by hand in position() below.
 */
const POPOVER =
	"xs-picker-popover fixed z-30 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised";
const SEARCH_ROW =
	"xs-picker-search-row flex items-center gap-2 border-b border-border px-2.5 py-2 text-muted";
const SEARCH =
	"xs-picker-search h-6 w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-muted";
const GROUP_LABEL =
	"xs-picker-group px-2.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase";
const OPTION =
	"xs-option flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-text transition-colors data-[active=true]:bg-accent-soft";
const EMPTY = "xs-picker-empty px-2.5 py-4 text-center text-[11.5px] text-muted";

export interface Picker {
	/** The wrapper to put in the form; the popover is positioned against it. */
	element: HTMLElement;
	/** The current value, for callers that would rather ask than track. */
	value: () => string;
}

export function picker(options: PickerOptions): Picker {
	const all = options.groups.flatMap((group) => group.items);
	let value = options.value;
	let open = false;
	/** Which row Enter would take, as an index into the filtered list. */
	let active = 0;
	let shown: PickerItem[] = all;

	const wrapper = el("div", "xs-picker relative");

	const trigger = el("button", TRIGGER);
	trigger.type = "button";
	trigger.id = options.id;
	trigger.setAttribute("aria-haspopup", "listbox");
	trigger.setAttribute("aria-expanded", "false");
	trigger.setAttribute("aria-label", options.ariaLabel);

	const chosen = el("span", "xs-picker-value min-w-0 flex-1 truncate");
	const caret = el("span", "flex-none text-muted");
	caret.append(renderIcon(ArrowDown01Icon, "h-4 w-4"));
	trigger.append(chosen, caret);

	const popover = el("div", POPOVER);
	popover.hidden = true;

	/*
	 * Room for the list to drop into.
	 *
	 * A browser action's window is as tall as its document, and before a lookup
	 * this panel's document ends a little under the form — so "below the
	 * trigger" is a couple of centimetres and the list opens as a stub. This
	 * grows the document while the list is open, which is what makes Chrome
	 * grow the window; the list is fixed, so it draws over the space rather
	 * than under it, and closing takes both away again.
	 */
	const spacer = el("div", "xs-picker-spacer");
	spacer.setAttribute("aria-hidden", "true");

	const search = el("input", SEARCH);
	search.type = "text";
	search.autocomplete = "off";
	search.placeholder = options.placeholder;
	search.setAttribute("role", "combobox");
	search.setAttribute("aria-expanded", "true");
	search.setAttribute("aria-controls", `${options.id}-list`);

	const searchRow = el("div", SEARCH_ROW);
	searchRow.append(renderIcon(Search01Icon, "h-4 w-4 flex-none"), search);

	const list = el("div", "xs-picker-list overflow-y-auto p-1.5");
	list.id = `${options.id}-list`;
	list.setAttribute("role", "listbox");

	popover.append(searchRow, list);
	wrapper.append(trigger, popover);

	/* --- drawing ------------------------------------------------------- */

	function paintTrigger(): void {
		chosen.textContent = all.find((item) => item.value === value)?.label ?? "";
		trigger.dataset["value"] = value;
	}

	function paintList(): void {
		const query = normalise(search.value);
		shown = query ? all.filter((item) => matches(item, query)) : all;
		// Keep the highlight inside the list it is pointing at.
		active = Math.min(active, Math.max(0, shown.length - 1));

		list.replaceChildren();
		if (shown.length === 0) {
			list.append(el("p", EMPTY, "Không tìm thấy tỉnh nào."));
			return;
		}

		for (const group of options.groups) {
			const items = group.items.filter((item) => shown.includes(item));
			if (items.length === 0) continue;

			// A search is one flat answer ranked by relevance to the typing; the
			// headings only help while the whole list is on screen.
			if (!query) list.append(el("p", GROUP_LABEL, group.label));
			for (const item of items) list.append(option(item));
		}
	}

	function option(item: PickerItem): HTMLElement {
		const row = el("div", OPTION);
		row.setAttribute("role", "option");
		row.dataset["value"] = item.value;
		row.dataset["active"] = String(shown.indexOf(item) === active);
		row.setAttribute("aria-selected", String(item.value === value));

		const tick = el("span", "flex-none text-accent");
		if (item.value === value) tick.append(renderIcon(Tick02Icon, "h-4 w-4"));
		else tick.className = "h-4 w-4 flex-none";

		row.append(tick, el("span", "min-w-0 flex-1 truncate", item.label));
		// mousedown, not click: the search input would lose focus first and the
		// blur handler would close the popover out from under the click.
		row.addEventListener("mousedown", (event) => {
			event.preventDefault();
			choose(item);
		});
		row.addEventListener("mousemove", () => {
			const index = shown.indexOf(item);
			if (index !== active) {
				active = index;
				markActive();
			}
		});
		return row;
	}

	function markActive(): void {
		for (const row of list.querySelectorAll<HTMLElement>(".xs-option")) {
			const isActive = shown[active]?.value === row.dataset["value"];
			row.dataset["active"] = String(isActive);
			if (isActive) {
				row.scrollIntoView({ block: "nearest" });
				search.setAttribute("aria-activedescendant", row.dataset["value"] ?? "");
			}
		}
	}

	/* --- behaviour ----------------------------------------------------- */

	/**
	 * Put the list under the trigger, always.
	 *
	 * Flipping it above when the room below ran short is the usual move and is
	 * wrong here: a browser action's window is only as tall as its document, so
	 * there is nothing above the trigger to open into — the list just gets cut
	 * off by the top of the popup. Dropping down and taking its height from
	 * whatever room is left is the version that always fits; when that room is
	 * small, the list scrolls inside itself.
	 *
	 * Width and height come from the viewport rather than from a class, which
	 * is the trade for being fixed and so not clipped by the scrolling view.
	 */
	function position(): void {
		const rect = trigger.getBoundingClientRect();
		const below = window.innerHeight - rect.bottom - 12;

		popover.style.left = `${rect.left}px`;
		popover.style.width = `${Math.max(rect.width, 240)}px`;
		popover.style.top = `${rect.bottom + 6}px`;
		popover.style.maxHeight = `${Math.min(288, Math.max(96, below))}px`;
	}

	/**
	 * Grow the document so the window has somewhere to put the list.
	 *
	 * Chrome caps a popup at 600px and will not grow past it, so this asks for
	 * what is missing and takes whatever it gets — position() runs again on the
	 * resize that follows and sizes the list to the room that actually arrived.
	 */
	function reserveRoom(): void {
		const rect = trigger.getBoundingClientRect();
		const wanted = rect.bottom + 6 + 288 + 12;
		const missing = wanted - document.documentElement.scrollHeight;
		if (missing <= 0) return;

		spacer.style.height = `${missing}px`;
		document.body.append(spacer);
	}

	function show(): void {
		open = true;
		popover.hidden = false;
		trigger.setAttribute("aria-expanded", "true");
		search.value = "";
		// Open on whatever is already chosen rather than at the top of the list.
		active = Math.max(0, all.findIndex((item) => item.value === value));
		paintList();
		// The list is measured against where the trigger is, so make sure that
		// is somewhere visible before measuring.
		trigger.scrollIntoView({ block: "nearest" });
		reserveRoom();
		position();
		markActive();
		search.focus();
		// Capture, so a scroll inside the detail view moves it too — the popover
		// is anchored to the viewport and would otherwise stay behind.
		window.addEventListener("scroll", position, true);
		window.addEventListener("resize", position);
	}

	function hide(): void {
		open = false;
		popover.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
		spacer.remove();
		window.removeEventListener("scroll", position, true);
		window.removeEventListener("resize", position);
	}

	function choose(item: PickerItem): void {
		const changed = item.value !== value;
		value = item.value;
		paintTrigger();
		hide();
		trigger.focus();
		if (changed) options.onChange(value);
	}

	trigger.addEventListener("click", () => (open ? hide() : show()));

	search.addEventListener("input", () => {
		active = 0;
		paintList();
		markActive();
	});

	search.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (shown.length === 0) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			active = (active + step + shown.length) % shown.length;
			markActive();
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const item = shown[active];
			if (item) choose(item);
			return;
		}
		if (event.key === "Escape" || event.key === "Tab") {
			hide();
			if (event.key === "Escape") trigger.focus();
		}
	});

	// Anywhere else in the popup closes it. Pointerdown rather than click so it
	// closes on the press, the way a menu does.
	document.addEventListener("pointerdown", (event) => {
		if (open && !wrapper.contains(event.target as Node)) hide();
	});

	paintTrigger();
	paintList();
	return { element: wrapper, value: () => value };
}

/* --- searching -------------------------------------------------------- */

function matches(item: PickerItem, query: string): boolean {
	// The spaceless copy is what lets "haugiang" match as well as "hau giang" —
	// a habit anyone who types Vietnamese without accents already has.
	const plain = normalise(`${item.label} ${item.keywords ?? ""}`);
	const haystack = `${plain} ${plain.replace(/\s+/g, "")}`;
	// Every word has to appear somewhere, so "giang hau" finds Hậu Giang too.
	return query
		.split(" ")
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

/**
 * Lowercased and stripped of diacritics.
 *
 * NFD splits a letter from its accents so the combining marks can be dropped;
 * đ is not a composed character and has to go by hand.
 */
function normalise(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "d")
		.toLowerCase()
		.trim();
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
