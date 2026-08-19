/**
 * The tool registry — the single source of truth for what this extension does.
 *
 * The popup builds its dashboard from this list, and storage derives its
 * defaults from it, so a new tool needs three things and no more:
 *
 *   1. a definition here,
 *   2. a content script under src/tools/<id>/,
 *   3. a content_scripts entry in extension/manifest.json pointing at it.
 *
 * A tool that works in the popup instead of on a page — T1 Esports Tracker is
 * the first — skips 2 and 3, sets `hasPanel`, and registers its renderer in
 * src/popup/tool-ui.ts.
 *
 * A tool whose in-page surface only appears on a click — Task Name Translator —
 * also skips 3: the service worker injects its bundle with chrome.scripting on
 * the gesture that needs it, so the tool costs every other page nothing.
 *
 * Keep this file free of DOM code whichever shape a tool takes: content scripts
 * import it through storage.ts.
 */

import { lottery } from "../tools/lottery/definition";
import { pinterestTheme } from "../tools/pinterest-theme/definition";
import { t1Tracker } from "../tools/t1-tracker/definition";
import { taskNamer } from "../tools/task-namer/definition";
import type { ToolDefinition, ToolState } from "./types";

export const TOOLS: ToolDefinition[] = [
	pinterestTheme,
	t1Tracker,
	taskNamer,
	lottery,
];

export function getTool(id: string): ToolDefinition | undefined {
	return TOOLS.find((tool) => tool.id === id);
}

/** The state a tool has before the user has touched anything. */
export function defaultStateFor(tool: ToolDefinition): ToolState {
	const settings: Record<string, string> = {};
	for (const setting of tool.settings) {
		settings[setting.key] = setting.default;
	}
	return { enabled: tool.defaultEnabled, settings };
}
