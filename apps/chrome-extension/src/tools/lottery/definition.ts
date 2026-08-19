import type { ToolDefinition } from "../../common/types";
import { LOTTERY_ID } from "./constants";

export const lottery: ToolDefinition = {
	id: LOTTERY_ID,
	name: "Dò vé số",
	description: "Check a Vietnamese lottery ticket by province and draw date.",
	scope: "xskt.com.vn",
	// Off until asked for, as the tracker is: switching it on is what permits
	// the first request to xskt.com.vn.
	defaultEnabled: false,
	settings: [],
	hasPanel: true,
};
