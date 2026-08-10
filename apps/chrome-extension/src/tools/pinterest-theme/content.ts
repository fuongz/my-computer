/*
 * Runs at document_start on pinterest.com, declared statically in the manifest
 * so Chrome injects it (and the stylesheet) before the page paints — no worker
 * has to wake up first, so there is no window where the theme can be missed.
 *
 * Its whole job is to own the html[data-pinterest-dark] attribute the
 * stylesheet is scoped to:
 *   - set it synchronously before first paint, so there is no white flash;
 *   - put it back if Pinterest's React tree strips it during an SPA route change;
 *   - drop it the moment the tool is switched off, or the extension's own
 *     appearance resolves to light.
 *
 * The stylesheet is inert without that attribute, so "off" costs the page a
 * parsed-but-unmatched stylesheet and nothing else.
 *
 * This bundle also carries the "How was this made?" dialog, which is NOT part
 * of the theme — it runs on every http(s) page, Pinterest or not. It lives in
 * analysis-dialog.ts and is entered at the one call below; the manifest
 * declares a single content script, which is the only reason the two ship
 * together.
 */

import { listenForAnalysisMessages, mountQuickTrigger } from "./analysis-dialog";
import {
	getAppearance,
	onAppearanceChanged,
	readMirroredAppearance,
	writeMirroredAppearance,
	type Appearance,
} from "../../common/appearance";
import {
	getToolStates,
	onToolStatesChanged,
	readMirroredStates,
	writeMirroredStates,
} from "../../common/storage";
import type { ToolStates } from "../../common/types";
import {
	PINTEREST_THEME_ID,
	THEME_ATTRIBUTE,
	THEME_COLOR,
} from "./constants";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const isPinterest = /(^|\.)pinterest\.com$/i.test(location.hostname);

/*
 * Both halves of the answer are kept here because each can change without the
 * other: the switch arrives on the tool-states key, the appearance on its own.
 * Whichever fires, the other is still needed to re-resolve.
 */
let states: ToolStates = readMirroredStates();
let appearance: Appearance = readMirroredAppearance();
let dark = resolveDark();

// Theme behavior remains Pinterest-only; prompt UI below runs on every HTTP(S) page.
if (isPinterest) {
	applyAttribute(dark);
	reconcileWithSyncedSettings();
	watchForSettingChanges();
	watchForSystemAppearanceChanges();
	keepThemeAcrossSpaNavigation();
}
listenForAnalysisMessages();
mountQuickTrigger();

/**
 * Collapses the two knobs — is the tool on, and what appearance did the user
 * pick for the extension — into the single boolean the rest of this file cares
 * about. The tool has no appearance of its own; it follows the popup's.
 */
function resolveDark(): boolean {
	if (!states[PINTEREST_THEME_ID]?.enabled) return false;
	if (appearance === "light") return false;
	if (appearance === "system") return systemDark.matches;
	return true;
}

/** The authoritative half: chrome.storage.sync, which follows the user's profile. */
function reconcileWithSyncedSettings(): void {
	void Promise.all([getToolStates(), getAppearance()]).then(
		([syncedStates, syncedAppearance]) => {
			states = syncedStates;
			appearance = syncedAppearance;
			writeMirroredStates(syncedStates);
			writeMirroredAppearance(syncedAppearance);
			setDark(resolveDark());
		},
	);
}

function watchForSettingChanges(): void {
	onToolStatesChanged((changed) => {
		states = changed;
		writeMirroredStates(changed);
		setDark(resolveDark());
	});

	onAppearanceChanged((changed) => {
		appearance = changed;
		writeMirroredAppearance(changed);
		setDark(resolveDark());
	});
}

/**
 * Only matters while the appearance is "system", but re-resolving is cheap and
 * returns the same answer otherwise, so there is nothing to gate on.
 */
function watchForSystemAppearanceChanges(): void {
	systemDark.addEventListener("change", () => setDark(resolveDark()));
}

/*
 * Pinterest never does a full page load after the first one, so the theme has
 * to survive client-side routing. Two things can knock it off: React rewriting
 * attributes on <html>, and the theme-color meta tag being swapped per route.
 */
function keepThemeAcrossSpaNavigation(): void {
	const observer = new MutationObserver(() => {
		if (!dark) return;
		if (document.documentElement.getAttribute(THEME_ATTRIBUTE) !== "on") {
			applyAttribute(true);
		}
	});

	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: [THEME_ATTRIBUTE, "class", "style"],
	});

	// <head> may not exist yet at document_start; the meta tag is re-asserted on
	// every route change below, so a one-shot at DOM ready covers the first view.
	onDomReady(applyThemeColorMeta);

	for (const method of ["pushState", "replaceState"] as const) {
		const original = history[method];
		history[method] = function patched(this: History, ...args: never[]) {
			const result = original.apply(this, args as never);
			onRouteChange();
			return result;
		} as typeof original;
	}

	window.addEventListener("popstate", onRouteChange);
}

function onRouteChange(): void {
	applyAttribute(dark);
	applyThemeColorMeta();
}

function setDark(value: boolean): void {
	if (value === dark) return;
	dark = value;
	applyAttribute(value);
	applyThemeColorMeta();
}

function applyAttribute(value: boolean): void {
	const root = document.documentElement;
	if (value) {
		root.setAttribute(THEME_ATTRIBUTE, "on");
	} else {
		root.removeAttribute(THEME_ATTRIBUTE);
	}
}

/** Pinterest's own theme-color, so switching off can put it back. */
let originalThemeColor: string | null = null;

/** Keeps the browser's own chrome (mobile address bar, some desktop UI) in step. */
function applyThemeColorMeta(): void {
	const head = document.head;
	if (!head) return;

	let meta = head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

	if (!dark) {
		if (!meta) return;
		if (originalThemeColor === null) meta.remove();
		else meta.content = originalThemeColor;
		return;
	}

	if (!meta) {
		meta = document.createElement("meta");
		meta.name = "theme-color";
		head.appendChild(meta);
	} else if (originalThemeColor === null && meta.content !== THEME_COLOR) {
		originalThemeColor = meta.content;
	}

	meta.content = THEME_COLOR;
}

function onDomReady(fn: () => void): void {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", fn, { once: true });
	} else {
		fn();
	}
}
