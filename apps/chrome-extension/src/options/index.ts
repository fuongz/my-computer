/**
 * The Settings page: one OpenRouter key, and the model it is spent on.
 *
 * The key field is never repopulated from storage — a reload must not be able to
 * reveal a saved key. The status line names its last four characters instead,
 * which is enough to tell two keys apart and useless to anyone else.
 */

import { getAppearance } from "../common/appearance";
import {
	clearSettings,
	fetchKeyInfo,
	getSettings,
	getStatus,
	OpenRouterError,
	saveSettings,
} from "../common/openrouter";
import { toTaskName } from "../tools/task-namer/naming";
import { applyMirroredAppearance, reconcile } from "../popup/theme";

/**
 * What **Test connection** rewrites.
 *
 * Vietnamese on purpose: the whole point of the tool is the language it is not
 * answering in, and a English-in English-out probe would pass on a model that
 * cannot do the one job.
 */
const PROBE = "sửa lỗi đăng nhập bị treo khi token hết hạn";

applyMirroredAppearance();
document.addEventListener("DOMContentLoaded", () => void init());

async function init(): Promise<void> {
	reconcile(await getAppearance());

	byId<HTMLButtonElement>("close-settings")?.addEventListener("click", () =>
		window.close(),
	);
	byId<HTMLFormElement>("openrouter-form")?.addEventListener(
		"submit",
		(event) => void save(event),
	);
	byId<HTMLButtonElement>("test-connection")?.addEventListener(
		"click",
		() => void test(),
	);
	byId<HTMLButtonElement>("clear-connection")?.addEventListener(
		"click",
		() => void disconnect(),
	);

	await refresh();
}

async function refresh(): Promise<void> {
	const status = await getStatus();

	const model = byId<HTMLInputElement>("model");
	if (model) model.value = status.model;

	const clear = byId<HTMLButtonElement>("clear-connection");
	if (clear) clear.hidden = !status.configured;

	setStatus(
		status.configured
			? `Key saved, ending ${status.keySuffix ?? "••••"}. Test it to check it works.`
			: "No key yet. Paste one and save.",
	);
}

async function save(event: SubmitEvent): Promise<void> {
	event.preventDefault();
	const key = byId<HTMLInputElement>("api-key");
	const model = byId<HTMLInputElement>("model");

	try {
		await saveSettings({
			...(key?.value ? { apiKey: key.value } : {}),
			...(model?.value ? { model: model.value } : {}),
		});
		// Cleared on the way out, so the saved key is not sitting in the DOM of a
		// tab that stays open.
		if (key) key.value = "";
		await refresh();
		await test();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Could not save.");
	}
}

/**
 * Prove the whole path, not half of it.
 *
 * Two round trips: the key, and then the model actually rewriting a line. The
 * second one exists because a valid key on a model that cannot answer looks
 * exactly like a working setup until you right-click something — which is how a
 * reasoning model that spent its entire token budget thinking got as far as
 * being the default here. If a model is going to fail, it should fail on this
 * button.
 */
async function test(): Promise<void> {
	const settings = await getSettings();
	if (!settings) {
		setStatus("Paste a key and save it first.");
		return;
	}

	setStatus("Checking the key…");
	let spend: string;
	try {
		const info = await fetchKeyInfo(settings.apiKey);
		spend =
			info.limit === null
				? `${usd(info.usage)} used, no limit`
				: `${usd(info.usage)} of ${usd(info.limit)} used`;
		if (info.freeTier) spend += " · free tier";
		spend = `${info.label} · ${spend}`;
	} catch (error) {
		setStatus(
			error instanceof OpenRouterError
				? `Key failed: ${error.message}`
				: "Key failed: could not reach OpenRouter.",
		);
		return;
	}

	setStatus(`Key works — ${spend}. Now trying ${settings.model}…`);
	try {
		const title = await toTaskName(settings, PROBE);
		setStatus(`Works — ${spend} · ${settings.model} wrote: “${title}”`);
	} catch (error) {
		setStatus(
			error instanceof OpenRouterError
				? `Key works — ${spend}. But ${error.message}`
				: `Key works — ${spend}. But the model call failed.`,
		);
	}
}

async function disconnect(): Promise<void> {
	if (!window.confirm("Remove the OpenRouter key from this browser?")) return;
	await clearSettings();
	await refresh();
}

function usd(value: number): string {
	return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function setStatus(message: string): void {
	const node = document.getElementById("connection-status");
	if (node) node.textContent = message;
}

function byId<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}
