import type { ToolDefinition } from "../../common/types";
import { LEAGUEPEDIA_SETTING, T1_TRACKER_ID } from "./constants";

export const t1Tracker: ToolDefinition = {
	id: T1_TRACKER_ID,
	name: "T1 Esports Tracker",
	description: "T1's matches, results and brackets.",
	scope: "lolesports.com",
	// Off until asked for: switching it on is what permits the first request to
	// Riot, and nothing else in this extension talks to a server.
	defaultEnabled: false,
	settings: [
		{
			key: LEAGUEPEDIA_SETTING,
			label: "Read Leaguepedia for seeding",
			hint: "A bracket that hasn't been filled in says which seed each slot is for, and which teams already have a place. Adds one request to lol.fandom.com per tournament you open.",
			// Off by default: the tool's own switch permits lolesports and nothing
			// else, and a second server is the user's call the same way the
			// OpenRouter key is.
			default: "off",
			options: [
				{ value: "on", label: "On" },
				{ value: "off", label: "Off" },
			],
		},
	],
	hasPanel: true,
};
