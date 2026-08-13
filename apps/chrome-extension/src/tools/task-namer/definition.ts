import type { ToolDefinition } from "../../common/types";
import { TASK_NAMER_ID } from "./constants";

export const taskNamer: ToolDefinition = {
	id: TASK_NAMER_ID,
	name: "Task Name Translator",
	description: "Right-click selected text for an English task title.",
	scope: "any page",
	// Off until asked for: switching it on is what puts the item in the context
	// menu and what permits the first call to OpenRouter. It also needs a key,
	// which the Settings button in the app bar is for.
	defaultEnabled: false,
	settings: [
		{
			key: "selection-popup",
			label: "Show popup on text selection",
			hint: "Display the task-title button when you highlight text on a page.",
			default: "on",
			options: [
				{ value: "on", label: "On" },
				{ value: "off", label: "Off" },
			],
		},
	],
};
