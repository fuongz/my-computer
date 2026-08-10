/**
 * The one appearance choice: Dark, Light, or follow the system.
 *
 * It began as a popup setting and is now shared — the Pinterest theme reads the
 * same value, so a single control decides how both the popup and pinterest.com
 * look, and a tool's own switch only says whether to apply it.
 *
 * That is why this lives in common/ rather than popup/: a content script
 * importing anything under popup/ would drag the dashboard's DOM code into
 * every content bundle.
 */

export type Appearance = "system" | "dark" | "light";

export const APPEARANCES: readonly Appearance[] = ["system", "dark", "light"];

/** chrome.storage.sync key, so the choice follows the profile. */
export const APPEARANCE_KEY = "fz.appearance.v1";

/**
 * The synchronous mirror, in whichever origin is doing the reading — the
 * popup's localStorage on an extension page, pinterest.com's in the content
 * script. Both exist for the same reason: chrome.storage is async, and at
 * document_start async means "after the page painted in the wrong theme".
 *
 * Each copy is rewritten from chrome.storage on every load, so neither can
 * drift for longer than one page view.
 */
const MIRROR_KEY = "__fz.appearance.v1";

/** Anything unrecognised — including nothing at all — means "follow the OS". */
export function resolveAppearance(value: unknown): Appearance {
	return value === "dark" || value === "light" || value === "system"
		? value
		: "system";
}

export async function getAppearance(): Promise<Appearance> {
	try {
		const stored = await chrome.storage.sync.get(APPEARANCE_KEY);
		return resolveAppearance(stored[APPEARANCE_KEY]);
	} catch {
		return "system";
	}
}

export async function setAppearance(value: Appearance): Promise<void> {
	await chrome.storage.sync.set({ [APPEARANCE_KEY]: value });
}

/** Fires whenever the choice changes, from any surface. */
export function onAppearanceChanged(
	listener: (value: Appearance) => void,
): void {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "sync") return;
		const change = changes[APPEARANCE_KEY];
		if (!change) return;
		listener(resolveAppearance(change.newValue));
	});
}

/* --- the synchronous mirror ------------------------------------------- */

export function readMirroredAppearance(): Appearance {
	try {
		return resolveAppearance(window.localStorage.getItem(MIRROR_KEY));
	} catch {
		// localStorage can be blocked. The async read puts it right a moment
		// later; all we lose is the head start.
		return "system";
	}
}

export function writeMirroredAppearance(value: Appearance): void {
	try {
		window.localStorage.setItem(MIRROR_KEY, value);
	} catch {
		// Same as above — next load just starts from the default again.
	}
}
