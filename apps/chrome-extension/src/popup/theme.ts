/**
 * The popup's half of the appearance setting: putting it on screen.
 *
 * The value itself lives in ../common/appearance.ts, because the Pinterest
 * content script reads the same one — see the note there.
 */

import {
	readMirroredAppearance,
	setAppearance as store,
	writeMirroredAppearance,
	type Appearance,
} from "../common/appearance";

/**
 * Stamp `data-theme` on <html>.
 *
 * "system" deliberately stamps nothing: the stylesheet's bare `:root` is the
 * light palette and its `prefers-color-scheme` block is the dark one, so the
 * absence of the attribute *is* the third state.
 */
export function applyAppearance(value: Appearance): void {
	const root = document.documentElement;
	if (value === "system") delete root.dataset["theme"];
	else root.dataset["theme"] = value;
}

/**
 * The earliest possible paint decision: read the mirror synchronously and act
 * on it. An extension page can't run an inline script — MV3's CSP is
 * `script-src 'self'` — so module top level is as early as it gets.
 */
export function applyMirroredAppearance(): void {
	applyAppearance(readMirroredAppearance());
}

/**
 * Bring the mirror in line with what storage actually says, and repaint if they
 * disagreed — which is what happens on a profile's second machine.
 */
export function reconcile(value: Appearance): void {
	writeMirroredAppearance(value);
	applyAppearance(value);
}

export async function setAppearance(value: Appearance): Promise<void> {
	reconcile(value);
	await store(value);
}
