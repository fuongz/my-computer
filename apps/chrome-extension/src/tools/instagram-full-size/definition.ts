import type { ToolDefinition } from "../../common/types";
import { INSTAGRAM_FULL_SIZE_ID } from "./constants";

export const instagramFullSize: ToolDefinition = {
	id: INSTAGRAM_FULL_SIZE_ID,
	name: "Instagram Full Size",
	description: "View and download Instagram photos at full size.",
	scope: "instagram.com",
	// Off until asked for: switching it on is what asks Instagram for a post's
	// full-size images, and what puts a button over every photo in the feed.
	defaultEnabled: false,
	settings: [],
};
