import type { ToolDefinition } from "../../common/types";
import {
	AUTO_SETTING,
	HOTKEY_SETTING,
	SETTING_OFF,
	SETTING_ON,
	YOUTUBE_CINEMA_ID,
} from "./constants";

export const youtubeCinema: ToolDefinition = {
	id: YOUTUBE_CINEMA_ID,
	name: "YouTube Cinema",
	description: "A watch page fills the window, with a toggle in the player.",
	scope: "youtube.com",
	// Off until asked for, as everything after the Pinterest theme is: the
	// switch is what lets the content script touch a single watch page.
	defaultEnabled: false,
	/*
	 * Neither of these is the way in — the player's own button is, and it is
	 * there whatever they say. They are the two conveniences on top: not having
	 * to press anything, and being able to press a key instead.
	 */
	settings: [
		{
			key: AUTO_SETTING,
			label: "Every video",
			hint: "A watch page opens with the video already filling the window.",
			default: SETTING_ON,
			options: [
				{ value: SETTING_ON, label: "On" },
				{ value: SETTING_OFF, label: "Off" },
			],
		},
		{
			key: HOTKEY_SETTING,
			label: "Shift+F hotkey",
			hint: "Toggle from the keyboard, and leave with Escape.",
			default: SETTING_ON,
			options: [
				{ value: SETTING_ON, label: "On" },
				{ value: SETTING_OFF, label: "Off" },
			],
		},
	],
};
