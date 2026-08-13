/*
 * The service worker: the context menu, and the only place the API key is read.
 *
 * Everything here belongs to the Task Name Translator. The other two tools need
 * no worker — the Pinterest theme is a declared content script and the T1
 * tracker lives in the popup.
 *
 * Two rules shape this file:
 *
 *   - The key never leaves the worker. The card injected into the page gets a
 *     finished string or an error sentence, and nothing else.
 *   - Nothing is assumed to survive between events. MV3 tears a worker down
 *     after ~30 seconds idle, so state lives in chrome.storage and every handler
 *     re-reads what it needs. The menu is rebuilt on startup for the same
 *     reason.
 */

import {
	getSettings,
	OpenRouterError,
	type OpenRouterSettings,
} from "../common/openrouter";
import { getToolStates, onToolStatesChanged } from "../common/storage";
import {
	MAX_SELECTION_LENGTH,
	OPEN_OPTIONS,
	OVERLAY_SCRIPT,
	OVERLAY_STYLES,
	TASK_NAME_ERROR,
	TASK_NAME_LOADING,
	TASK_NAME_RESULT,
	TASK_NAME_REQUEST,
	TASK_NAMER_ID,
	supportsReplace,
} from "../tools/task-namer/constants";
import { toTaskName } from "../tools/task-namer/naming";

const MENU_ID = "fz-translate-to-task-name";

const NO_KEY =
	"Add your OpenRouter API key in Settings, then try again.";

/* --- the menu ---------------------------------------------------------- */

/*
 * The switch in the popup is what puts the item in the menu, so a tool that is
 * off costs a right-click nothing. Both events fire on a cold worker; removeAll
 * first makes either one safe to run twice.
 */
chrome.runtime.onInstalled.addListener(() => void syncMenu());
chrome.runtime.onStartup.addListener(() => void syncMenu());
onToolStatesChanged((states) => void syncMenu(states[TASK_NAMER_ID]?.enabled));

async function syncMenu(enabled?: boolean): Promise<void> {
	const on =
		enabled ?? (await getToolStates())[TASK_NAMER_ID]?.enabled ?? false;

	await chrome.contextMenus.removeAll();
	if (!on) return;

	chrome.contextMenus.create({
		id: MENU_ID,
		title: "Translate to task name",
		contexts: ["selection"],
	});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId !== MENU_ID || !tab?.id) return;
	// Chrome's own `pageUrl`, not anything the page said about itself.
	void translate(tab.id, info.selectionText ?? "", supportsReplace(info.pageUrl));
});

/* --- messages from the card -------------------------------------------- */

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
	if (!raw || typeof raw !== "object") return;
	const message = raw as { type?: string; source?: string };

	if (message.type === OPEN_OPTIONS) {
		void chrome.runtime.openOptionsPage();
	}
	if (message.type === TASK_NAME_REQUEST && sender.tab?.id && message.source) {
		/*
		 * `sender.url` — the frame Chrome saw the message leave, not anything the
		 * message said about itself, so a page cannot dress itself up as a
		 * spreadsheet. `sender.tab.url` is the better-known field and the wrong
		 * one here: it is only populated with the `tabs` permission or host access
		 * to that tab, and the in-page button's path grants neither.
		 */
		void translate(
			sender.tab.id,
			message.source,
			supportsReplace(sender.url ?? sender.tab.url),
		);
	}
});

/* --- the work ---------------------------------------------------------- */

async function translate(
	tabId: number,
	selection: string,
	canReplace: boolean,
): Promise<void> {
	const source = selection.trim().slice(0, MAX_SELECTION_LENGTH);
	if (!source) return;

	// Sent before anything is read or called, so the card is on screen — showing
	// what was actually picked up — for the whole wait, rather than appearing
	// once the answer is already in.
	await send(tabId, { type: TASK_NAME_LOADING, source, canReplace });

	let settings: OpenRouterSettings | null;
	try {
		settings = await getSettings();
	} catch {
		settings = null;
	}

	if (!settings) {
		return send(tabId, {
			type: TASK_NAME_ERROR,
			source,
			canReplace,
			message: NO_KEY,
			openSettings: true,
		});
	}

	try {
		const taskName = await toTaskName(settings, source);
		await send(tabId, { type: TASK_NAME_RESULT, source, canReplace, taskName });
	} catch (error) {
		await send(tabId, {
			type: TASK_NAME_ERROR,
			source,
			canReplace,
			...describe(error),
		});
	}
}

/** One translation from a failure to what the card should say and offer. */
function describe(error: unknown): { message: string; openSettings?: boolean } {
	if (error instanceof OpenRouterError) {
		return error.needsSettings
			? { message: error.message, openSettings: true }
			: { message: error.message };
	}
	return { message: "Something went wrong talking to OpenRouter." };
}

/**
 * Deliver a message to the card, injecting it first if the page has none.
 *
 * The card is not a declared content script, so the first message to any tab
 * always lands here. `activeTab` is what makes the injection legal: Chrome
 * grants it for this tab when the user picks the extension's context-menu item,
 * which is the only path into this function.
 */
async function send(tabId: number, message: object): Promise<void> {
	try {
		await chrome.tabs.sendMessage(tabId, message);
		return;
	} catch {
		// No card in this tab yet — fall through and put one there.
	}

	try {
		await chrome.scripting.insertCSS({
			target: { tabId },
			files: [OVERLAY_STYLES],
		});
		await chrome.scripting.executeScript({
			target: { tabId },
			files: [OVERLAY_SCRIPT],
		});
		await chrome.tabs.sendMessage(tabId, message);
	} catch {
		/*
		 * Chrome refuses injection on its own pages, the Web Store, and PDFs, and
		 * there is nowhere to report that — the failure is the absence of a card.
		 * Swallowing it beats an unhandled rejection in a worker the user cannot
		 * see.
		 */
	}
}
