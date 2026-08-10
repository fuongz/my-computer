/*
 * The dashboard. Everything on screen is derived from the tool registry, so a
 * new tool appears here without this file changing.
 *
 * Two views share the popup: the list of tool cards, and one tool's detail
 * view. Writes are optimistic — the switch flips immediately and chrome.storage
 * catches up — because the content scripts react to the storage write, not to
 * anything the popup tells them.
 *
 * A detail view is a tool's settings, its own panel (see ./panels.ts), or both.
 * This file knows about neither: it asks the registry what to draw and hands a
 * panel its host element.
 *
 * Styling is Tailwind utilities written straight onto the elements. The bare
 * class names alongside them (.tool-card, .switch-input, …) carry no styles —
 * they are what this file, the panels and preview-popup.ts address elements by.
 * Never build one of those strings by concatenation: Tailwind reads them out of
 * this source, and a name assembled at runtime compiles to nothing.
 */

import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ComputerIcon,
	Moon02Icon,
	Settings02Icon,
	Sun03Icon,
} from "@hugeicons/core-free-icons";

import { renderIcon, type IconData } from "../common/icons";
import {
	menu,
	MENU_CHIP,
	segmented,
	switchControl,
	type MenuRow,
} from "../common/ui";
import { getTool, TOOLS } from "../common/registry";
import {
	getToolStates,
	setToolEnabled,
	setToolSetting,
} from "../common/storage";
import type { ToolDefinition, ToolSetting, ToolStates } from "../common/types";
import {
	APPEARANCES,
	getAppearance,
	type Appearance,
} from "../common/appearance";
import { getPanel, getToolIcon } from "./tool-ui";

import { applyMirroredAppearance, reconcile, setAppearance } from "./theme";

/*
 * Before anything renders, and before the first paint: an extension page can't
 * run an inline script, so module top level is the earliest there is. See
 * ./theme.ts for why this reads localStorage rather than chrome.storage.
 */
applyMirroredAppearance();

let states: ToolStates = {};

document.addEventListener("DOMContentLoaded", init);

async function init(): Promise<void> {
	const [toolStates, appearance] = await Promise.all([
		getToolStates(),
		getAppearance(),
	]);
	states = toolStates;

	// Storage is the truth; the mirror was only a head start, and can be stale
	// on the second machine a profile syncs to.
	reconcile(appearance);
	renderAppearance(appearance);

	renderDashboard();
	renderSummary();
	showDashboard();

	const back = byId("back");
	back.prepend(renderIcon(ArrowLeft01Icon, "h-4 w-4"));
	back.addEventListener("click", showDashboard);

	const settings = byId("settings");
	settings.append(renderIcon(Settings02Icon, "h-[17px] w-[17px]"));
	settings.addEventListener("click", () => void chrome.runtime.openOptionsPage());
}

/* --- appearance ------------------------------------------------------- */

/**
 * Icons rather than words: three text segments ate 150px of the app bar and
 * pushed the extension's own name onto a second line. The label survives as
 * screen-reader text.
 */
const APPEARANCE_OPTIONS: Record<Appearance, { label: string; icon: IconData }> =
	{
		system: { label: "Auto", icon: ComputerIcon },
		dark: { label: "Dark", icon: Moon02Icon },
		light: { label: "Light", icon: Sun03Icon },
	};

function renderAppearance(current: Appearance): void {
	byId("appearance").replaceChildren(
		segmented({
			name: "appearance",
			ariaLabel: "Appearance",
			value: current,
			items: APPEARANCES.map((value) => ({
				value,
				label: APPEARANCE_OPTIONS[value].label,
				icon: APPEARANCE_OPTIONS[value].icon,
			})),
			onChange: (value: string) => void setAppearance(resolve(value)),
		}),
	);
}

/** The control speaks in strings; the store speaks in the union. */
function resolve(value: string): Appearance {
	return value === "dark" || value === "light" ? value : "system";
}

/* --- dashboard -------------------------------------------------------- */

function renderDashboard(): void {
	const host = byId("tool-list");
	const tools = menu(TOOLS.map(toolRow));
	tools.classList.add(
		"tool-grid",
		"!overflow-visible",
		"!rounded-none",
		"!border-0",
		"!bg-transparent",
		"!shadow-none",
	);
	host.replaceChildren(tools);
	for (const tool of TOOLS) markEnabled(tool.id, isEnabled(tool.id));

	const empty = TOOLS.length === 0;
	byId("empty-state").hidden = !empty;
	byId("more-soon").hidden = empty;
}

/** One tool as a menu row: chip, name and description, then its switch. */
function toolRow(tool: ToolDefinition): MenuRow {
	// Only worth opening if there is something in there: settings, a panel, or
	// both. A tool with neither stays a plain row with a switch.
	const openable = tool.settings.length > 0 || tool.hasPanel === true;

	return {
		id: tool.id,
		className: "tool-card group",
		chip: toolIcon(tool),
		title: tool.name,
		subtitle: tool.description,
		openLabel: `Open ${tool.name}`,
		...(openable ? { onOpen: () => showDetail(tool.id) } : {}),
		trailing: openable ? openTrailing(tool) : toolSwitch(tool),
	};
}

/** An openable row shows a chevron *and* its switch. */
function openTrailing(tool: ToolDefinition): HTMLElement {
	const group = el("div", "flex flex-none items-center gap-2");
	group.append(chevron(), toolSwitch(tool));
	return group;
}

function toolSwitch(tool: ToolDefinition): HTMLElement {
	return switchControl({
		id: `switch-${tool.id}`,
		ariaLabel: `Enable ${tool.name}`,
		checked: isEnabled(tool.id),
		onChange: (enabled: boolean) => void setEnabled(tool.id, enabled),
	});
}

/** A row reflects its tool's state through `data-enabled`, as the card did. */
function markEnabled(toolId: string, enabled: boolean): void {
	const row = document.querySelector<HTMLElement>(
		`[data-row-id="${CSS.escape(toolId)}"]`,
	);
	if (row) row.dataset["enabled"] = String(enabled);
}

function renderSummary(): void {
	const on = TOOLS.filter((tool) => isEnabled(tool.id)).length;
	byId("summary").textContent =
		TOOLS.length === 0
			? "No tools yet"
			: `${on} of ${TOOLS.length} ${TOOLS.length === 1 ? "tool" : "tools"} active`;
}

/* --- detail view ------------------------------------------------------ */

function showDetail(toolId: string): void {
	const tool = getTool(toolId);
	if (!tool) return;

	const detail = el("div", "detail group flex flex-col gap-3.5");
	detail.dataset["enabled"] = String(isEnabled(tool.id));

	// A tool that draws its own view gets a host here; the renderer owns
	// everything inside it, including its own loading and error states.
	const panel = getPanel(tool.id);
	const panelHost = panel ? el("div", "panel-host contents") : undefined;

	// The switch lives in the view's header, opposite the way back — the tool
	// only has one, and a labelled row of its own said nothing the header
	// doesn't.
	byId("detail-switch").replaceChildren(
		switchControl({
			id: `detail-switch-${tool.id}`,
			ariaLabel: `Enable ${tool.name}`,
			checked: isEnabled(tool.id),
			onChange: (enabled: boolean) => {
				detail.dataset["enabled"] = String(enabled);
				// The switch is what permits a panel to do any work at all, so
				// it has to redraw here rather than wait for the view to reopen.
				if (panel && panelHost) panel(panelHost, enabled);
				void setEnabled(tool.id, enabled);
			},
		}),
	);

	if (panel && panelHost) {
		detail.append(panelHost);
		panel(panelHost, isEnabled(tool.id));
	}
	detail.append(...tool.settings.map((setting) => renderSetting(tool, setting)));

	if (tool.settings.length > 0) {
		detail.append(
			el(
				"p",
				"off-note text-[11px] leading-snug text-muted group-data-[enabled=true]:hidden",
				"These apply once the tool is switched on.",
			),
		);
	}

	byId("detail-body").replaceChildren(detail);
	byId("view-dashboard").hidden = true;
	byId("view-detail").hidden = false;
	byId("back").focus();
}

function renderSetting(
	tool: ToolDefinition,
	setting: ToolSetting,
): HTMLElement {
	const block = el("div", "setting flex flex-col gap-[7px]");
	block.append(
		el(
			"span",
			"setting-label text-xs font-semibold tracking-wide text-muted uppercase",
			setting.label,
		),
		segmented({
			name: `${tool.id}-${setting.key}`,
			ariaLabel: setting.label,
			value: states[tool.id]?.settings[setting.key] ?? setting.default,
			items: setting.options,
			onChange: (value: string) => {
				const state = states[tool.id];
				if (state) state.settings[setting.key] = value;
				void setToolSetting(tool.id, setting.key, value);
			},
		}),
	);

	if (setting.hint) {
		block.append(
			el("p", "setting-hint text-[11px] leading-snug text-muted", setting.hint),
		);
	}
	return block;
}

function showDashboard(): void {
	byId("view-detail").hidden = true;
	byId("view-dashboard").hidden = false;
}

/* --- shared bits ------------------------------------------------------ */


function chevron(): HTMLSpanElement {
	const wrapper = el("span", "chevron flex-none text-muted");
	wrapper.append(renderIcon(ArrowRight01Icon, "h-4 w-4"));
	return wrapper;
}

function toolIcon(tool: ToolDefinition): HTMLSpanElement {
	const wrapper = el(
		"span",
		`tool-icon ${MENU_CHIP} transition-colors group-data-[enabled=true]:text-accent`,
	);
	const icon = getToolIcon(tool.id);
	if (icon) wrapper.append(renderIcon(icon, "h-[18px] w-[18px]"));
	return wrapper;
}

async function setEnabled(toolId: string, enabled: boolean): Promise<void> {
	const state = states[toolId];
	if (state) state.enabled = enabled;

	// Keep both views and the header in step without a full re-render, which
	// would drop focus from whatever the user just clicked.
	for (const input of document.querySelectorAll<HTMLInputElement>(
		`#switch-${CSS.escape(toolId)}, #detail-switch-${CSS.escape(toolId)}`,
	)) {
		input.checked = enabled;
	}
	markEnabled(toolId, enabled);
	renderSummary();

	await setToolEnabled(toolId, enabled);
}

function isEnabled(toolId: string): boolean {
	return states[toolId]?.enabled ?? false;
}

function byId(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`popup: missing #${id}`);
	return element;
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
