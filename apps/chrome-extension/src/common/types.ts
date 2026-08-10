/**
 * The shapes the tool registry is built from.
 *
 * A "tool" is one self-contained thing the extension does to one set of sites.
 * The registry (see ./registry.ts) is the only place that knows which tools
 * exist; the popup renders itself from it, and storage derives its defaults
 * from it. Adding a tool should mean adding a definition and a content script,
 * and touching neither the popup nor the storage layer.
 */

/** One choice in a {@link ToolSetting}. Rendered as a segment in the popup. */
export interface ToolSettingOption {
	value: string;
	label: string;
}

/**
 * A single option a tool exposes in its detail view.
 *
 * Only multiple-choice settings exist so far — that is all the Pinterest tool
 * needs — so the popup has exactly one control to render. Widen this to a
 * discriminated union when a tool wants something else.
 */
export interface ToolSetting {
	key: string;
	label: string;
	/** One line under the control explaining what the choice does. */
	hint?: string;
	options: ToolSettingOption[];
	default: string;
}

export interface ToolDefinition {
	/** Stable storage key. Never rename one of these without a migration. */
	id: string;
	name: string;
	description: string;
	/**
	 * Where it runs — e.g. "pinterest.com". Documentation for the registry
	 * rather than something the popup draws: the detail view is the tool's own
	 * content now, and nothing there needs restating where it applies.
	 */
	scope: string;
	/** Whether the tool is on the first time the popup is opened. */
	defaultEnabled: boolean;
	settings: ToolSetting[];
	/**
	 * Whether this tool draws its own detail view on top of its settings.
	 *
	 * The renderer itself lives in src/popup/panels.ts, not here: content
	 * scripts reach this file through storage.ts, and a renderer referenced from
	 * the registry would drag the popup's DOM code into every content bundle.
	 */
	hasPanel?: boolean;
}

/** The persisted half of a tool: what the user has changed about it. */
export interface ToolState {
	enabled: boolean;
	/** Keyed by {@link ToolSetting.key}; always fully populated once resolved. */
	settings: Record<string, string>;
}

/** Every tool's state, keyed by {@link ToolDefinition.id}. */
export type ToolStates = Record<string, ToolState>;
