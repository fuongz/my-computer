/**
 * Persistence for the tool registry.
 *
 * Everything lives under one chrome.storage.sync key holding a
 * `{ [toolId]: { enabled, settings } }` blob. One key rather than one per tool
 * means a single onChanged event to listen for, and a single value to mirror
 * into localStorage for content scripts that have to decide before first paint.
 *
 * Stored values are never trusted: {@link resolveStates} rebuilds the state
 * from the registry every read, so an unknown tool id, a dropped setting, or a
 * value that is no longer a valid option all degrade to the default.
 */

import { PINTEREST_THEME_ID } from "../tools/pinterest-theme/constants";
import { defaultStateFor, getTool, TOOLS } from "./registry";
import type { ToolStates } from "./types";

/** chrome.storage.sync key holding every tool's state. */
export const STORAGE_KEY = "fz.tools.v1";

/**
 * Mirror of the above in the page's own localStorage.
 *
 * chrome.storage is async, and at document_start "async" means "after the page
 * has already painted white". Content scripts read this synchronously to decide
 * what to do, then reconcile against chrome.storage.sync.
 */
export const LOCAL_MIRROR_KEY = "__fz.tools.v1";

/** Pre-registry keys: a bare boolean for the Pinterest theme, and its mirror. */
const LEGACY_PINTEREST_ENABLED_KEY = "pinterestDarkEnabled";
const LEGACY_LOCAL_MIRROR_KEY = "__pinterestDarkEnabled";

/**
 * Fold whatever is in storage into a fully-populated state for every
 * registered tool. Pure, so the content script's sync path and the popup's
 * async path cannot disagree.
 */
export function resolveStates(raw: unknown, legacy?: unknown): ToolStates {
	const stored = isRecord(raw) ? raw : {};
	const states: ToolStates = {};

	for (const tool of TOOLS) {
		const state = defaultStateFor(tool);
		const entry = stored[tool.id];

		if (isRecord(entry)) {
			if (typeof entry["enabled"] === "boolean")
				state.enabled = entry["enabled"];

			const settings = entry["settings"];
			if (isRecord(settings)) {
				for (const setting of tool.settings) {
					const value = settings[setting.key];
					const known = setting.options.some(
						(option) => option.value === value,
					);
					if (known && typeof value === "string")
						state.settings[setting.key] = value;
				}
			}
		} else if (tool.id === PINTEREST_THEME_ID && typeof legacy === "boolean") {
			// Migration: before the registry existed, the Pinterest theme's on/off
			// state was a boolean of its own. Honour it until the user writes the
			// new blob, which happens the first time they touch anything.
			state.enabled = legacy;
		}

		states[tool.id] = state;
	}

	return states;
}

export async function getToolStates(): Promise<ToolStates> {
	const result = await chrome.storage.sync.get([
		STORAGE_KEY,
		LEGACY_PINTEREST_ENABLED_KEY,
	]);
	return resolveStates(
		result[STORAGE_KEY],
		result[LEGACY_PINTEREST_ENABLED_KEY],
	);
}

export async function setToolEnabled(
	toolId: string,
	enabled: boolean,
): Promise<void> {
	const states = await getToolStates();
	const state = states[toolId];
	if (!state) return;
	await write({ ...states, [toolId]: { ...state, enabled } });
}

export async function setToolSetting(
	toolId: string,
	key: string,
	value: string,
): Promise<void> {
	const tool = getTool(toolId);
	const states = await getToolStates();
	const state = states[toolId];
	if (!tool || !state) return;
	if (!tool.settings.some((setting) => setting.key === key)) return;

	await write({
		...states,
		[toolId]: { ...state, settings: { ...state.settings, [key]: value } },
	});
}

/** Fires whenever any tool's state changes, from any surface. */
export function onToolStatesChanged(
	listener: (states: ToolStates) => void,
): void {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "sync") return;
		const change = changes[STORAGE_KEY];
		if (!change) return;
		listener(resolveStates(change.newValue));
	});
}

/* --- the synchronous mirror, for content scripts ---------------------- */

/**
 * The sync half of the read. Falls back to registry defaults on the very first
 * visit after install, when nothing has been cached yet.
 */
export function readMirroredStates(): ToolStates {
	try {
		const cached = window.localStorage.getItem(LOCAL_MIRROR_KEY);
		if (cached) return resolveStates(JSON.parse(cached));

		// First load after upgrading: the new mirror does not exist yet, but the
		// old one does. Without this a user who had the theme off would get one
		// dark frame before chrome.storage catches up.
		const legacy = window.localStorage.getItem(LEGACY_LOCAL_MIRROR_KEY);
		if (legacy === "true" || legacy === "false") {
			return resolveStates(undefined, legacy === "true");
		}
	} catch {
		// localStorage can be blocked, and the cache can be malformed. Neither is
		// fatal — we just fall back to defaults and reconcile a moment later.
	}
	return resolveStates(undefined);
}

export function writeMirroredStates(states: ToolStates): void {
	try {
		window.localStorage.setItem(LOCAL_MIRROR_KEY, JSON.stringify(states));
	} catch {
		// Same as above — the async path still works, we just flash on next load.
	}
}

async function write(states: ToolStates): Promise<void> {
	await chrome.storage.sync.set({ [STORAGE_KEY]: states });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
