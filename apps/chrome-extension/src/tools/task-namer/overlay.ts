/*
 * Everything this tool does inside a page: the button that appears over a
 * selection, and the popover that answers.
 *
 * This one IS declared in the manifest, on every http(s) page, which the
 * Pinterest theme's sibling deliberately is not. A button that appears when you
 * select text has to be listening before you select it, and there is no way to
 * be listening on a page you have not been injected into. That is the whole
 * trade, and it is why the tool ships switched off: with the switch off this
 * file attaches nothing and reads nothing.
 *
 * It holds no key and makes no request. Everything it knows arrives as a
 * message and everything it wants goes back the same way — this code runs in a
 * document the extension does not trust.
 */

import { renderIcon } from "../../common/icons";
import { TaskEdit01Icon } from "@hugeicons/core-free-icons";
import {
	getToolStates,
	onToolStatesChanged,
	readMirroredStates,
	writeMirroredStates,
} from "../../common/storage";
import type { ToolStates } from "../../common/types";
import {
	MAX_SELECTION_LENGTH,
	MIN_SELECTION_LENGTH,
	OPEN_OPTIONS,
	TASK_NAME_ERROR,
	TASK_NAME_LOADING,
	TASK_NAME_REQUEST,
	TASK_NAME_RESULT,
	TASK_NAMER_ID,
} from "./constants";

declare global {
	interface Window {
		__fzTaskNamerMounted?: true;
	}
}

if (!window.__fzTaskNamerMounted) {
	window.__fzTaskNamerMounted = true;
	mount();
}

interface Message {
	type?: string;
	source?: string;
	taskName?: string;
	message?: string;
	openSettings?: boolean;
	canReplace?: boolean;
}

/** Where something is on the page, in page coordinates rather than viewport. */
interface Anchor {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function mount(): void {
	/** The text the card is about, so Try again can ask again. */
	let source = "";
	/** Whether this page is one the title may be written back into. */
	let canReplace = false;
	/** Where the selection was, so the popover can point at it. */
	let anchor: Anchor | null = null;

	let card: HTMLElement | null = null;
	let trigger: HTMLButtonElement | null = null;

	/** The box the text is being corrected in, while one is open. */
	let editor: HTMLTextAreaElement | null = null;
	/** How to draw the state the editor was opened from, so Cancel can go back. */
	let back: (() => HTMLElement) | null = null;

	/*
	 * The page's own focus and selection, held while the editor has them.
	 *
	 * Replace writes into whatever the page has focused and selected — see
	 * replaceButton — and typing in the card takes both away. So they are noted on
	 * the way into the editor and handed back on the way out, and the title still
	 * lands in the cell the card was opened over.
	 */
	let borrowed: { from: Element | null; range: Range | null } | null = null;

	/*
	 * The switch, read synchronously from the mirror and then reconciled. With
	 * the tool off nothing is drawn and no selection is looked at — the listeners
	 * stay attached because attaching and detaching them on every storage change
	 * is more moving parts than one boolean test per mouseup.
	 */
	let enabled = isOn(readMirroredStates());
	void getToolStates().then((states) => {
		enabled = isOn(states);
		writeMirroredStates(states);
		if (!enabled) hideTrigger();
	});
	onToolStatesChanged((states) => {
		enabled = isOn(states);
		writeMirroredStates(states);
		if (!enabled) {
			hideTrigger();
			dismiss();
		}
	});

	function isOn(states: ToolStates): boolean {
		const state = states[TASK_NAMER_ID];
		return state?.enabled === true && state.settings["selection-popup"] === "on";
	}

	/* --- messages from the worker --------------------------------------- */

	chrome.runtime.onMessage.addListener((raw: unknown) => {
		if (!raw || typeof raw !== "object") return;
		const message = raw as Message;
		if (typeof message.source === "string") source = message.source;
		if (typeof message.canReplace === "boolean") canReplace = message.canReplace;

		switch (message.type) {
			case TASK_NAME_LOADING:
				// A right-click arrives here without having gone through the
				// trigger, so this is the first chance to note where to point.
				if (!anchor) anchor = selectionAnchor();
				show(loading);
				break;
			case TASK_NAME_RESULT: {
				const taskName = message.taskName ?? "";
				show(() => result(taskName));
				break;
			}
			case TASK_NAME_ERROR: {
				const text = message.message ?? "Something went wrong.";
				const settings = message.openSettings === true;
				show(() => failure(text, settings));
				break;
			}
		}
	});

	/* --- the button over the selection ----------------------------------- */

	/*
	 * `mouseup` and `keyup`, not `selectionchange`: the latter fires on every
	 * pixel of a drag, so a button bound to it flickers along under the cursor.
	 * These fire once, when the user has finished saying what they meant.
	 */
	document.addEventListener("mouseup", onSelectionSettled, true);
	document.addEventListener("keyup", onSelectionSettled, true);
	document.addEventListener("mousedown", onPointerDown, true);
	document.addEventListener("keydown", onKeydown, true);

	function onSelectionSettled(event: Event): void {
		if (!enabled) return;
		// Our own UI is not a page to offer a button over.
		if (ours(event.target)) return;

		// After the event, so the selection the browser is about to commit is the
		// one we read.
		setTimeout(() => {
			const selection = window.getSelection();
			const text = selection?.toString().trim() ?? "";
			if (!selection || selection.isCollapsed || text.length < MIN_SELECTION_LENGTH) {
				hideTrigger();
				return;
			}
			showTrigger(text, selection);
		}, 0);
	}

	function onPointerDown(event: Event): void {
		// A press outside both surfaces means the user is done with them. The
		// trigger and the card guard their own mousedown, so this never fires for
		// a press on either.
		if (ours(event.target)) return;
		hideTrigger();
	}

	function showTrigger(text: string, selection: Selection): void {
		const rects = selection.getRangeAt(0).getClientRects();
		const last = rects[rects.length - 1];
		if (!last) return;

		const button = trigger ?? createTrigger();
		button.dataset["source"] = text;

		/*
		 * Just below the end of the selection: that is where the cursor was
		 * released, so the button lands under the hand that is already there.
		 *
		 * Below rather than above because `last` is the final line of the
		 * selection, and on anything that wrapped, "above the last line" is "on
		 * top of the line before it" — the button would cover the very text it is
		 * offering to rewrite. It flips up only when the window bottom is nearer
		 * than the button is tall.
		 */
		const size = 30;
		const room = window.innerHeight - last.bottom;
		const below = room >= size + 10;
		place(button, {
			left: window.scrollX + last.right - size / 2,
			top: window.scrollY + (below ? last.bottom + 6 : last.top - size - 6),
		});
	}

	function createTrigger(): HTMLButtonElement {
		const button = el("button", "fz-tn-trigger");
		button.setAttribute("type", "button");
		button.setAttribute("aria-label", "Write a task title from this");
		button.setAttribute("title", "Write a task title from this");
		button.append(renderIcon(TaskEdit01Icon, "fz-tn-trigger-icon"));

		// The selection is the input. Letting a press move focus would collapse
		// it before the click that reads it ever runs.
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			const text = button.dataset["source"] ?? "";
			anchor = selectionAnchor();
			hideTrigger();
			if (text) void chrome.runtime.sendMessage({ type: TASK_NAME_REQUEST, source: text });
		});

		document.documentElement.append(button);
		trigger = button as HTMLButtonElement;
		return trigger;
	}

	function hideTrigger(): void {
		trigger?.remove();
		trigger = null;
	}

	/* --- the popover ------------------------------------------------------ */

	/**
	 * Draw a state, and remember how to draw it again.
	 *
	 * The editor is a detour rather than a state of its own — you step out of an
	 * answer to correct what was asked, and back into it if you change your mind —
	 * so what is kept is the builder, not the element it built. Rebuilding is what
	 * makes Cancel land on a card whose buttons are wired up, rather than on a
	 * detached copy of one.
	 */
	function show(build: () => HTMLElement): void {
		back = build;
		leaveEditor();
		render(build());
	}

	/**
	 * One card, reused. Replacing its body rather than the whole element keeps
	 * focus inside it across the loading → result step, and keeps the popover
	 * from re-animating on every message.
	 */
	function render(body: HTMLElement): void {
		const host = card ?? create();
		const slot = host.querySelector(".fz-tn-body");
		if (slot) slot.replaceChildren(body);
		position(host);
	}

	function create(): HTMLElement {
		const host = el("div", "fz-tn-card");
		host.setAttribute("role", "dialog");
		host.setAttribute("aria-label", "Task name");
		// Pages set wild `direction` and `font-size` on <html>; the card should
		// read the same on all of them.
		host.setAttribute("dir", "ltr");
		host.addEventListener("mousedown", (event) => {
			// Every press in the card is swallowed so the page keeps the selection
			// Replace is aimed at. The editor is the one control that has to be able
			// to take focus, and it gives the selection back when it closes.
			const target = event.target;
			if (target instanceof Element && target.closest(".fz-tn-input")) return;
			event.preventDefault();
		});

		const header = el("div", "fz-tn-header");
		header.append(el("span", "fz-tn-title", "Task name"));

		const close = el("button", "fz-tn-close");
		close.setAttribute("type", "button");
		close.setAttribute("aria-label", "Close");
		close.append(closeMark());
		close.addEventListener("click", dismiss);
		header.append(close);

		host.append(el("span", "fz-tn-arrow"), header, el("div", "fz-tn-body"));
		document.documentElement.append(host);

		card = host;
		return host;
	}

	/**
	 * Point the card at the text it is about.
	 *
	 * Page coordinates and `position: absolute`, not viewport and `fixed`: a
	 * popover that stays put while the text it points at scrolls away is worse
	 * than one that scrolls with it. Measured after the body is filled in,
	 * because where it fits depends on how tall it turned out.
	 */
	function position(host: HTMLElement): void {
		if (!anchor) {
			// No selection to point at — the right-click path can land here if the
			// selection was dropped. A corner is honest about pointing at nothing.
			host.dataset["place"] = "corner";
			host.style.left = "";
			host.style.top = "";
			return;
		}

		const width = host.offsetWidth;
		const height = host.offsetHeight;
		const gap = 12;
		const margin = 8;

		const belowTop = anchor.bottom + gap;
		const roomBelow = window.scrollY + window.innerHeight - belowTop - margin;
		const below = roomBelow >= height || anchor.top - window.scrollY < height;

		const centre = (anchor.left + anchor.right) / 2;
		const left = clamp(
			centre - width / 2,
			window.scrollX + margin,
			window.scrollX + window.innerWidth - width - margin,
		);

		host.dataset["place"] = below ? "below" : "above";
		place(host, { left, top: below ? belowTop : anchor.top - height - gap });

		// The arrow tracks the selection, not the card: clamped to stay on the
		// card's own edge once the card has been pushed away from centre.
		const arrow = host.querySelector<HTMLElement>(".fz-tn-arrow");
		if (arrow) arrow.style.left = `${clamp(centre - left, 16, width - 16)}px`;
	}

	function dismiss(): void {
		leaveEditor();
		card?.remove();
		card = null;
		anchor = null;
		back = null;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== "Escape") return;
		if (!card && !trigger) return;
		event.stopPropagation();
		// Escape backs out one step at a time: out of the editor first, and only
		// out of the card once there is no edit left to abandon.
		if (editor) {
			cancelEdit();
			return;
		}
		hideTrigger();
		dismiss();
	}

	/* --- the three states ------------------------------------------------ */

	/**
	 * What was actually picked up, shown in every state.
	 *
	 * Worth the space: Chrome normalises whitespace and truncates a selection at
	 * 1024 characters, and a drag that grabbed one word too few is invisible
	 * otherwise — you would just get a title that is subtly about the wrong
	 * thing, with nothing on screen to explain why.
	 */
	function before(canEdit: boolean): HTMLElement {
		const wrap = el("div", "fz-tn-before");

		const head = el("div", "fz-tn-before-head");
		head.append(el("span", "fz-tn-label", "Selected"));
		// Not while the answer is still being written: the only thing that button
		// could do mid-flight is throw away a request that is already paid for.
		if (canEdit) head.append(editButton());

		wrap.append(head, el("p", "fz-tn-source", source));
		return wrap;
	}

	function loading(): HTMLElement {
		const wrap = el("div", "fz-tn-state");
		if (source) wrap.append(before(false));

		const busy = el("div", "fz-tn-busy");
		busy.append(el("span", "fz-tn-spinner"), el("p", "fz-tn-note", "Writing…"));
		wrap.append(busy);
		return wrap;
	}

	function result(taskName: string): HTMLElement {
		const wrap = el("div", "fz-tn-state");
		if (source) wrap.append(before(true));

		// A <p>, not an input: the answer is to be read and copied, and a text
		// field invites editing that nothing would save.
		wrap.append(el("p", "fz-tn-result", taskName));

		const actions: HTMLButtonElement[] = [];

		// Where the title can go straight into the cell, that is the thing you
		// came for and Copy is the fallback — so they swap emphasis.
		if (canReplace) actions.push(replaceButton(taskName));

		const copy = button("Copy", canReplace ? "fz-tn-ghost" : "fz-tn-primary");
		copy.addEventListener("click", () => {
			void navigator.clipboard.writeText(taskName).then(
				() => flash(copy, "Copied"),
				() => flash(copy, "Press ⌘C"),
			);
		});
		actions.push(copy);
		actions.push(againButton());

		wrap.append(row(...actions));
		return wrap;
	}

	/**
	 * Write the title over whatever is still selected on the page.
	 *
	 * `execCommand` is deprecated and is still the only way to do this that
	 * leaves the host app's own undo stack intact — Sheets' cell editor is a
	 * contenteditable, and setting its text by hand gives you a cell you cannot
	 * ⌘Z out of.
	 *
	 * It works at all because this card does not take focus: it guards its own
	 * `mousedown`, so the selection being replaced is still there when the click
	 * lands. The editor is the single exception, and it gives both the focus and
	 * the selection back on the way out for exactly this reason.
	 */
	function replaceButton(taskName: string): HTMLButtonElement {
		const replace = button("Replace", "fz-tn-primary");
		replace.addEventListener("click", () => {
			const done = document.execCommand("insertText", false, taskName);
			flash(replace, done ? "Replaced" : "Select it again");
		});
		return replace;
	}

	function againButton(): HTMLButtonElement {
		const again = button("Try again", "fz-tn-ghost");
		again.addEventListener("click", () => {
			render(loading());
			void chrome.runtime.sendMessage({ type: TASK_NAME_REQUEST, source });
		});
		return again;
	}

	/* --- correcting what was asked ---------------------------------------- */

	/**
	 * Sits beside the label rather than in the row of answers, and is quieter than
	 * the buttons there — it acts on the text above it, not on the title below.
	 */
	function editButton(): HTMLButtonElement {
		const edit = el("button", "fz-tn-edit", "Edit");
		edit.setAttribute("type", "button");
		edit.setAttribute("title", "Change the text and write a new title");
		edit.addEventListener("click", openEditor);
		return edit as HTMLButtonElement;
	}

	/**
	 * The selection, opened up for correction.
	 *
	 * Try again rolls the same dice again, which is the wrong tool for the common
	 * failure: a drag that grabbed one word too few, or a cell that says "login
	 * bug" and leaves out where. Those want a different question, not another
	 * answer to the same one.
	 *
	 * This is the one place the card takes focus, and it is why borrowed exists.
	 */
	function openEditor(): void {
		const wrap = el("div", "fz-tn-state");

		const input = el("textarea", "fz-tn-input");
		input.value = source;
		// The floor grow() cannot shrink past. Two lines is where most selections
		// land, so a box that fits them exactly would jump every time one wrapped.
		input.rows = 3;
		input.spellcheck = false;
		// The same ceiling the worker cuts at. Better the limit is met while the
		// text is still on screen than applied silently to something already sent.
		input.maxLength = MAX_SELECTION_LENGTH;
		input.setAttribute("aria-label", "Text to write a title from");

		const field = el("div", "fz-tn-before");
		field.append(el("span", "fz-tn-label", "Selected"), input);

		const go = button("Regenerate", "fz-tn-primary");
		go.addEventListener("click", () => regenerate(input.value));

		const cancel = button("Cancel", "fz-tn-ghost");
		cancel.addEventListener("click", cancelEdit);

		/** Nothing to name is not a request worth sending. */
		function sync(): void {
			const ready = input.value.trim().length > 0;
			go.disabled = !ready;
			go.classList.toggle("fz-tn-off", !ready);
		}

		input.addEventListener("input", () => {
			sync();
			grow(input);
		});
		input.addEventListener("keydown", (event) => {
			// ⌘↵ / Ctrl+↵, the shortcut every message box has. Plain Enter stays a
			// newline: a selection can be more than one line, and eating that would
			// be its own bug.
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				regenerate(input.value);
			}
		});

		sync();
		wrap.append(field, row(go, cancel));

		editor = input;
		borrowFocus();
		render(wrap);

		// After the card has been filled in and measured: a box with no height yet
		// scrolls to the wrong place, and the card's own height has just changed.
		grow(input);
		input.focus({ preventScroll: true });
		input.setSelectionRange(input.value.length, input.value.length);
		if (card) position(card);
	}

	/**
	 * Fit the box to the text, up to the ceiling it starts scrolling at — the same
	 * 168px `.fz-tn-input` caps itself at, so a box grown past it is clamped by
	 * CSS rather than left hanging out of the card.
	 */
	function grow(input: HTMLTextAreaElement): void {
		input.style.height = "auto";
		// `box-sizing: border-box` is set on everything in the card, so the height
		// asked for has to carry the borders that scrollHeight leaves out.
		const borders = input.offsetHeight - input.clientHeight;
		input.style.height = `${Math.min(input.scrollHeight + borders, 168)}px`;
	}

	function regenerate(text: string): void {
		const next = text.trim();
		if (!next) return;

		leaveEditor();
		// Set here rather than waited for: the worker echoes the same string back
		// with every message, but the card should show what it just asked for
		// without a round trip first.
		source = next;
		render(loading());
		void chrome.runtime.sendMessage({ type: TASK_NAME_REQUEST, source: next });
	}

	function cancelEdit(): void {
		leaveEditor();
		if (back) render(back());
	}

	/** Close the editor, handing the page back its focus and its selection. */
	function leaveEditor(): void {
		if (!editor) return;
		editor = null;
		returnFocus();
	}

	function borrowFocus(): void {
		if (borrowed) return;
		const selection = window.getSelection();
		borrowed = {
			from: document.activeElement,
			range:
				selection && selection.rangeCount > 0
					? selection.getRangeAt(0).cloneRange()
					: null,
		};
	}

	function returnFocus(): void {
		const held = borrowed;
		borrowed = null;
		if (!held) return;

		if (held.from instanceof HTMLElement) held.from.focus({ preventScroll: true });
		if (!held.range) return;

		const selection = window.getSelection();
		selection?.removeAllRanges();
		try {
			selection?.addRange(held.range);
		} catch {
			// A range whose nodes the page has since torn out throws rather than
			// missing quietly. There is nothing to do but leave the page unselected,
			// which is what Replace's "Select it again" already covers.
		}
	}

	function failure(message: string, openSettings: boolean): HTMLElement {
		const wrap = el("div", "fz-tn-state");
		if (source) wrap.append(before(true));
		wrap.append(el("p", "fz-tn-error", message));

		const actions: HTMLElement[] = [];
		if (openSettings) {
			const settings = button("Open settings", "fz-tn-primary");
			settings.addEventListener("click", () => {
				void chrome.runtime.sendMessage({ type: OPEN_OPTIONS });
				dismiss();
			});
			actions.push(settings);
		}

		if (source) actions.push(againButton());
		if (actions.length) wrap.append(row(...actions));
		return wrap;
	}

	/* --- small parts ----------------------------------------------------- */

	/** Says what happened without moving anything: the label returns by itself. */
	function flash(target: HTMLButtonElement, text: string): void {
		const original = target.textContent ?? "";
		target.textContent = text;
		target.disabled = true;
		setTimeout(() => {
			target.textContent = original;
			target.disabled = false;
		}, 1400);
	}

	function ours(target: EventTarget | null): boolean {
		return target instanceof Node
			? Boolean(card?.contains(target)) || Boolean(trigger?.contains(target))
			: false;
	}
}

/** The current selection in page coordinates, or null if there is none. */
function selectionAnchor(): Anchor | null {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return null;
	}

	const rect = selection.getRangeAt(0).getBoundingClientRect();
	// A collapsed or detached range measures zero on both axes and would put the
	// popover in the top-left corner of the document.
	if (rect.width === 0 && rect.height === 0) return null;

	return {
		left: rect.left + window.scrollX,
		right: rect.right + window.scrollX,
		top: rect.top + window.scrollY,
		bottom: rect.bottom + window.scrollY,
	};
}

function place(node: HTMLElement, at: { left: number; top: number }): void {
	node.style.left = `${Math.round(at.left)}px`;
	node.style.top = `${Math.round(at.top)}px`;
}

function clamp(value: number, low: number, high: number): number {
	// `high` can fall below `low` on a window narrower than the card.
	return Math.max(low, Math.min(value, Math.max(low, high)));
}

/**
 * The cross, drawn rather than typed.
 *
 * `×` is a font glyph centred on the math axis, which sits above the middle of
 * its line box by an amount that depends on whichever font resolves — and the
 * host page decides that, not us. In a 24px button a two-pixel drift is the
 * difference between centred and not. Two strokes in a viewBox are centred by
 * geometry, on every page.
 */
function closeMark(): SVGSVGElement {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("class", "fz-tn-close-mark");
	svg.setAttribute("fill", "none");
	svg.setAttribute("aria-hidden", "true");

	for (const d of ["M7 7 17 17", "M17 7 7 17"]) {
		const path = document.createElementNS(NS, "path");
		path.setAttribute("d", d);
		path.setAttribute("stroke", "currentColor");
		path.setAttribute("stroke-width", "1.8");
		path.setAttribute("stroke-linecap", "round");
		svg.append(path);
	}

	return svg;
}

function row(...children: HTMLElement[]): HTMLElement {
	const wrap = el("div", "fz-tn-actions");
	wrap.append(...children);
	return wrap;
}

function button(label: string, variant: string): HTMLButtonElement {
	const node = el("button", `fz-tn-btn ${variant}`, label);
	node.setAttribute("type", "button");
	return node as HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
