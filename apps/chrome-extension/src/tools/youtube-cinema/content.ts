/*
 * Runs at document_start on www.youtube.com, declared statically in the
 * manifest so the stylesheet is in place before the page paints and a watch
 * page never has to flash its own layout first.
 *
 * Its job is the html[data-fz-youtube-cinema] attribute cinema.css is scoped
 * to — plus the one thing cinema owes the viewer, a way home over the video,
 * since hiding the masthead hides the YouTube logo with it — and the four
 * questions that decide whether the attribute belongs there:
 *
 *   - is the tool switched on,
 *   - is this a watch page,
 *   - is the browser already in native fullscreen, which does this better,
 *   - and has Shift+F or Escape said otherwise for this page.
 *
 * Beyond that attribute and that one button, nothing here touches the page. The
 * video is made big by CSS; the only script YouTube's player hears from is a
 * synthetic resize event, which asks it to re-measure controls it sized in
 * pixels.
 */

import {
	getToolStates,
	onToolStatesChanged,
	readMirroredStates,
	writeMirroredStates,
} from "../../common/storage";
import type { ToolStates } from "../../common/types";
import {
	AUTO_SETTING,
	CINEMA_ATTRIBUTE,
	CINEMA_BACK_CLASS,
	HOTKEY_SETTING,
	SETTING_ON,
	YOUTUBE_CINEMA_ID,
	YOUTUBE_HOME,
} from "./constants";

let states: ToolStates = readMirroredStates();

/**
 * What the hotkey said, for the page currently open: `true` asked for cinema,
 * `false` asked for YouTube's layout back, `null` means nobody has asked and
 * the setting decides. Cleared on every navigation — a watch page opened from
 * a related video starts from the setting again, not from the last answer.
 */
let override: boolean | null = null;

/** Whether the attribute is on, so a no-op sync costs nothing. */
let on = false;

/*
 * The way home's constants and state, declared here rather than beside the
 * functions that use them further down. The boot sequence below is synchronous
 * and reaches createBackButton() on any load where the mirrored state already
 * says the tool is on — which is every load after the first — and a `const`
 * read above its own declaration is a ReferenceError, not undefined.
 */

/** The way back: a plain left arrow, on the same 24x24 grid. */
const BACK_ARROW = "M19 12H6.5M12 6.5L6.5 12l5.5 5.5";

const SVG_NS = "http://www.w3.org/2000/svg";

let back: HTMLButtonElement | null = null;

sync();
reconcileWithSyncedSettings();
watchForSettingChanges();
watchForNavigation();
watchForHotkeys();
watchForNativeFullscreen();
watchForPlayerRebuilds();

/* --- the decision ----------------------------------------------------- */

function wanted(): boolean {
	if (!states[YOUTUBE_CINEMA_ID]?.enabled) return false;
	if (!isWatchPage()) return false;
	// Native fullscreen already fills the screen, and fills it better — it takes
	// the browser's own chrome with it. Stand down until it is over.
	if (document.fullscreenElement) return false;
	if (override !== null) return override;
	return setting(AUTO_SETTING);
}

/** Both settings are on/off, and an absent one reads as its default: on. */
function setting(key: string): boolean {
	return (states[YOUTUBE_CINEMA_ID]?.settings[key] ?? SETTING_ON) === SETTING_ON;
}

/** `/watch` is the page with the grid around the video; `/live/` becomes one. */
function isWatchPage(): boolean {
	const path = window.location.pathname;
	return path === "/watch" || path.startsWith("/live/");
}

function sync(): void {
	const next = wanted();

	if (next !== on) {
		on = next;

		const root = document.documentElement;
		if (on) root.setAttribute(CINEMA_ATTRIBUTE, "on");
		else root.removeAttribute(CINEMA_ATTRIBUTE);

		remeasurePlayer();
	}

	// Unconditional: the switch can go off, or the page stop being a watch page,
	// without the attribute having been on in the first place.
	ensureBack();
}

/**
 * The player sizes its control bar, its tooltips and its storyboard preview in
 * pixels, from a measurement it takes on window resize. The CSS has already
 * corrected the video and the control bar's own box, so this is what brings the
 * rest of the player's internal arithmetic along.
 *
 * Fired three times because the player may not exist yet: this runs at
 * document_start on the first view, and the element it is talking to is built
 * some way into the page's own boot.
 */
function remeasurePlayer(): void {
	const fire = () => window.dispatchEvent(new Event("resize"));
	fire();
	requestAnimationFrame(fire);
	window.setTimeout(fire, 300);
}

/* --- everything that can change the answer ---------------------------- */

/** The authoritative half: chrome.storage.sync, which follows the profile. */
function reconcileWithSyncedSettings(): void {
	void getToolStates().then((synced) => {
		states = synced;
		writeMirroredStates(synced);
		sync();
	});
}

function watchForSettingChanges(): void {
	onToolStatesChanged((changed) => {
		states = changed;
		writeMirroredStates(changed);
		// A switch or a setting is a fresh instruction; whatever the hotkey said
		// about this page was answering the old one.
		override = null;
		sync();
	});
}

/*
 * YouTube does one page load and routes in the client for the rest of the
 * session, so leaving a watch page has to be noticed rather than waited for.
 * yt-navigate-finish is YouTube's own signal and fires with the new page's DOM
 * in place; the history patch catches the routes it does not announce.
 */
function watchForNavigation(): void {
	const onNavigate = (): void => {
		override = null;
		sync();
	};

	document.addEventListener("yt-navigate-finish", onNavigate);
	window.addEventListener("popstate", onNavigate);

	for (const method of ["pushState", "replaceState"] as const) {
		const original = history[method];
		history[method] = function patched(this: History, ...args: never[]) {
			const result = original.apply(this, args as never);
			onNavigate();
			return result;
		} as typeof original;
	}
}

/**
 * Shift+F toggles, Escape leaves — while the hotkey setting says so. Both keys
 * are read in the capture phase on window, which is upstream of the player's own
 * key handling, so Shift+F never reaches whatever YouTube would otherwise do
 * with an F.
 *
 * Escape is deliberately not swallowed: it is also how a player menu closes,
 * and a keystroke that does both is closer to what pressing it means.
 */
function watchForHotkeys(): void {
	window.addEventListener(
		"keydown",
		(event) => {
			if (!states[YOUTUBE_CINEMA_ID]?.enabled) return;
			if (!setting(HOTKEY_SETTING)) return;
			if (!isWatchPage()) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.repeat) return;
			if (isTyping(event.target)) return;

			if (event.shiftKey && event.code === "KeyF") {
				event.preventDefault();
				event.stopPropagation();
				override = !on;
				sync();
				return;
			}

			if (event.key === "Escape" && on) {
				override = false;
				sync();
			}
		},
		true,
	);
}

/** A hotkey has no business firing while the user is writing a comment. */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT"
	);
}

/* --- the way out, top left ------------------------------------------- */

/**
 * Cinema hides the masthead, and with it the YouTube logo — the one thing on
 * that page that goes home. So it puts one back, over the video where Netflix
 * keeps its own: only while cinema is on, and only while the player is showing
 * its controls, which cinema.css does by following the player's own autohide
 * class rather than tracking the pointer itself.
 */
function ensureBack(): void {
	if (!on) {
		back?.remove();
		back = null;
		return;
	}

	const player = document.querySelector("ytd-watch-flexy #movie_player");
	if (!player) return;

	if (!back) back = createBackButton();
	if (back.parentElement !== player) player.append(back);
}

function createBackButton(): HTMLButtonElement {
	const element = document.createElement("button");
	element.className = CINEMA_BACK_CLASS;
	element.type = "button";
	element.title = "Back to YouTube";
	element.setAttribute("aria-label", "Back to YouTube");

	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "#fff");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");

	const arrow = document.createElementNS(SVG_NS, "path");
	arrow.setAttribute("d", BACK_ARROW);
	svg.append(arrow);
	element.append(svg);

	element.addEventListener("click", (event) => {
		// It sits on top of the video, where a click means play/pause.
		event.preventDefault();
		event.stopPropagation();
		window.location.assign(YOUTUBE_HOME);
	});

	return element;
}

/**
 * The player is rebuilt — for an ad break, a size change, a new video — and
 * anything the page put inside it goes with it. Rather than guess when, this
 * watches for the DOM changing at all and re-checks; the check itself is a
 * parent-node comparison, and it is debounced to once a frame.
 */
function watchForPlayerRebuilds(): void {
	let queued = false;
	const observer = new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			ensureBack();
		});
	});

	const observe = () => observer.observe(document.body, { childList: true, subtree: true });
	if (document.body) observe();
	else document.addEventListener("DOMContentLoaded", observe, { once: true });
}

/**
 * Entering native fullscreen drops the attribute so YouTube's own fullscreen
 * layout is the only thing positioning the player; leaving it puts cinema back,
 * rather than dumping the viewer into the grid they never asked to see.
 */
function watchForNativeFullscreen(): void {
	document.addEventListener("fullscreenchange", () => {
		sync();
		remeasurePlayer();
	});
}
