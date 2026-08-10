import type { ToolDefinition } from "../../common/types";
import { PINTEREST_THEME_ID } from "./constants";

export const pinterestTheme: ToolDefinition = {
	id: PINTEREST_THEME_ID,
	name: "Pinterest Dark/Light",
	description: "A dark theme for pinterest.com.",
	scope: "pinterest.com",
	defaultEnabled: true,
	// No appearance setting of its own: the extension has one, in the app bar,
	// and this tool follows it. The switch only says whether to apply it.
	settings: [],
};
