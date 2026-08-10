/**
 * The popup's half of each tool: the mark it is drawn with, and the view it
 * draws for itself.
 *
 * Neither belongs in the registry. Content scripts reach
 * src/common/registry.ts through storage.ts, so anything hanging off a tool's
 * definition ships to every page that tool runs on — a panel renderer would
 * drag the popup's DOM code along, and an icon drags a couple of kilobytes of
 * SVG that no content script will ever draw. The registry says which tools
 * exist; this says what they look like.
 */

import { Calendar03Icon, DarkModeIcon } from "@hugeicons/core-free-icons";

import type { IconData } from "../common/icons";
import { PINTEREST_THEME_ID } from "../tools/pinterest-theme/constants";
import { T1_TRACKER_ID } from "../tools/t1-tracker/constants";
import { renderT1Panel } from "../tools/t1-tracker/panel";

/** Every tool's mark, from Hugeicons' free Stroke Rounded set. */
const TOOL_ICONS: Record<string, IconData> = {
	[PINTEREST_THEME_ID]: DarkModeIcon,
	[T1_TRACKER_ID]: Calendar03Icon,
};

export function getToolIcon(toolId: string): IconData | undefined {
	return TOOL_ICONS[toolId];
}

/**
 * Draw a tool's panel into `host`, replacing whatever was there.
 *
 * Called again whenever the tool is switched on or off while its detail view is
 * open, so a renderer must be safe to run repeatedly against the same host.
 */
export type PanelRenderer = (host: HTMLElement, enabled: boolean) => void;

const PANELS: Record<string, PanelRenderer> = {
	[T1_TRACKER_ID]: renderT1Panel,
};

export function getPanel(toolId: string): PanelRenderer | undefined {
	return PANELS[toolId];
}
