import {
	ApiError,
	fetchGeneration,
	requestAnalysis,
	requestImage,
	toDisplayableUrl,
} from "../common/api-client";
import { getConnection } from "../common/connection";

const MENU_ID = "fz-generate-pinterest-prompt";

const NOT_CONNECTED =
	"Connect this extension to your account first: add the API base URL and an API key in Settings.";

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({
			id: MENU_ID,
			title: "How was this made?",
			contexts: ["image"],
		});
	});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) return;
	void send(tab.id, { type: "fz:prompt-dialog", imageUrl: info.srcUrl });
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
	if (!message || typeof message !== "object") return;
	const event = message as {
		type?: string;
		prompt?: string;
		imageUrl?: string;
		generationId?: string;
	};
	if (event.type === "fz:open-options") {
		void chrome.runtime.openOptionsPage();
	}
	if (event.type === "fz:generate-image" && event.prompt) {
		if (sender.tab?.id) void startImage(sender.tab.id, event.prompt);
	}
	if (event.type === "fz:poll-image" && event.generationId) {
		if (sender.tab?.id) void checkImage(sender.tab.id, event.generationId);
	}
	if (event.type === "fz:analyze-image" && event.imageUrl && sender.tab?.id) {
		void analyze(sender.tab.id, event.imageUrl);
	}
});

async function analyze(tabId: number, imageUrl: string): Promise<void> {
	await send(tabId, { type: "fz:prompt-loading" });

	const connection = await getConnection();
	if (!connection) {
		return send(tabId, {
			type: "fz:prompt-error",
			message: NOT_CONNECTED,
			openSettings: true,
		});
	}

	try {
		const prompt = await requestAnalysis(connection, imageUrl);
		await send(tabId, { type: "fz:prompt-result", prompt });
	} catch (error) {
		await send(tabId, { type: "fz:prompt-error", ...describe(error) });
	}
}

/**
 * Start a generation and hand its id back. Deliberately does not wait for it.
 *
 * The waiting is the content script's job — see the note above `startImagePoll` in
 * analysis-dialog.ts. A service worker cannot be trusted to survive its own timer,
 * and one that dies mid-wait leaves the dialog spinning with nothing to retry.
 */
async function startImage(tabId: number, prompt: string): Promise<void> {
	const connection = await getConnection();
	if (!connection) {
		return send(tabId, {
			type: "fz:image-error",
			message: NOT_CONNECTED,
			openSettings: true,
		});
	}

	try {
		const started = await requestImage(connection, prompt);
		await send(tabId, { type: "fz:image-pending", generationId: started.id });
	} catch (error) {
		await send(tabId, { type: "fz:image-error", ...describe(error) });
	}
}

/**
 * One check of one generation, in answer to one message.
 *
 * Stateless on purpose: nothing here has to still be alive between polls, so the
 * worker being recycled between ticks costs nothing. While it is still running, the
 * dialog is told nothing — its own timer decides when to stop asking.
 */
async function checkImage(tabId: number, generationId: string): Promise<void> {
	const connection = await getConnection();
	if (!connection) {
		return send(tabId, {
			type: "fz:image-error",
			message: NOT_CONNECTED,
			openSettings: true,
		});
	}

	try {
		const generation = await fetchGeneration(connection, generationId);
		if (generation.status === "processing") return;

		if (generation.status === "failed" || !generation.imageUrl) {
			return send(tabId, {
				type: "fz:image-error",
				message: generation.error?.message ?? "The image could not be generated.",
			});
		}

		const imageUrl = await toDisplayableUrl(connection, generation.imageUrl);
		await send(tabId, { type: "fz:image-result", imageUrl });
	} catch (error) {
		await send(tabId, { type: "fz:image-error", ...describe(error) });
	}
}

/** One translation from a failure to what the dialog should say and offer. */
function describe(error: unknown): { message: string; openSettings?: boolean } {
	if (error instanceof ApiError) {
		// The API's own message already explains an exhausted allowance, including that
		// a provider key of your own lifts the limit — so it is passed through as-is.
		return error.needsSettings
			? { message: error.message, openSettings: true }
			: { message: error.message };
	}
	return { message: "Something went wrong talking to the API." };
}

async function send(tabId: number, message: object): Promise<void> {
	try {
		await chrome.tabs.sendMessage(tabId, message);
	} catch {
		// Existing tabs do not receive a newly-declared content script until their
		// next reload. Inject on demand so a context-menu click works immediately.
		await chrome.scripting.insertCSS({
			target: { tabId },
			files: ["dist/tools/pinterest-theme.css"],
		});
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["dist/tools/pinterest-theme.js"],
		});
		await chrome.tabs.sendMessage(tabId, message);
	}
}
