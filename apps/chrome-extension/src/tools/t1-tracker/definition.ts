import type { ToolDefinition } from "../../common/types";
import { T1_TRACKER_ID } from "./constants";

export const t1Tracker: ToolDefinition = {
	id: T1_TRACKER_ID,
	name: "T1 Esports Tracker",
	description: "T1's matches, results and brackets.",
	scope: "lolesports.com",
	// Off until asked for: switching it on is what permits the first request to
	// Riot, and nothing else in this extension talks to a server.
	defaultEnabled: false,
	settings: [],
	hasPanel: true,
};
