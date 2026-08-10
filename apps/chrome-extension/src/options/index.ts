import { ApiError, fetchAccount } from "../common/api-client";
import { getAppearance } from "../common/appearance";
import {
	clearConnection,
	getConnection,
	getConnectionStatus,
	normalizeBaseUrl,
	saveConnection,
	setSync,
} from "../common/connection";
import {
	clearLegacyProviderKeys,
	findLegacyProviderKeys,
} from "../common/legacy-keys";
import { applyMirroredAppearance, reconcile } from "../popup/theme";

applyMirroredAppearance();
document.addEventListener("DOMContentLoaded", () => void init());

const PROVIDER_LABELS: Record<string, string> = {
	openrouter: "OpenRouter",
	replicate: "Replicate",
};

async function init(): Promise<void> {
	reconcile(await getAppearance());
	document
		.getElementById("close-settings")
		?.addEventListener("click", () => window.close());

	document
		.getElementById("connection-form")
		?.addEventListener("submit", (event) => void save(event));
	document
		.getElementById("test-connection")
		?.addEventListener("click", () => void test());
	document
		.getElementById("clear-connection")
		?.addEventListener("click", () => void disconnect());
	document
		.getElementById("sync-toggle")
		?.addEventListener("change", (event) =>
			void setSync((event.target as HTMLInputElement).checked),
		);
	document
		.getElementById("clear-legacy-keys")
		?.addEventListener("click", () => void removeLegacy());

	await refresh();
	await refreshLegacy();
}

async function refresh(): Promise<void> {
	const status = await getConnectionStatus();
	const url = document.getElementById("api-base-url") as HTMLInputElement | null;
	const sync = document.getElementById("sync-toggle") as HTMLInputElement | null;
	const clear = document.getElementById("clear-connection") as HTMLButtonElement | null;

	if (url) url.value = status.apiBaseUrl;
	if (sync) sync.checked = status.sync;
	if (clear) clear.hidden = !status.configured;

	// The key input is never repopulated — a reload must not be able to reveal it.
	setStatus(
		status.configured
			? `Connected · key ending ${status.keySuffix ?? "••••"}`
			: "Not connected",
	);
}

async function save(event: SubmitEvent): Promise<void> {
	event.preventDefault();
	const url = document.getElementById("api-base-url") as HTMLInputElement | null;
	const key = document.getElementById("api-key") as HTMLInputElement | null;
	if (!url) return;

	try {
		const apiBaseUrl = normalizeBaseUrl(url.value);
		// Asked for at the moment of a click, so the extension ships with no standing
		// access to any host: whatever API the user names is the only one it can reach.
		const granted = await chrome.permissions.request({
			origins: [`${new URL(apiBaseUrl).origin}/*`],
		});
		if (!granted) {
			setStatus("Permission to reach that URL was declined, so it was not saved.");
			return;
		}

		await saveConnection({ apiBaseUrl, apiKey: key?.value });
		if (key) key.value = "";
		await refresh();
		await test();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Could not save the connection.");
	}
}

/** Reports the account, which provider each call will use, and what is left today. */
async function test(): Promise<void> {
	const connection = await getConnection();
	if (!connection) {
		setStatus("Add the API base URL and a key first.");
		return;
	}

	setStatus("Testing…");
	try {
		const account = await fetchAccount(connection);
		const modes = Object.entries(account.providers)
			.map(([provider, state]) => {
				const label = PROVIDER_LABELS[provider] ?? provider;
				if (state.mode === "byok") return `${label}: your key ····${state.last4 ?? ""}`;
				return state.available
					? `${label}: free allowance`
					: `${label}: unavailable — add your own key`;
			})
			.join(" · ");
		const left = `${account.allowance.analyses.remaining} of ${account.allowance.analyses.limit} analyses and ${account.allowance.images.remaining} of ${account.allowance.images.limit} images left today`;
		setStatus(`Signed in as ${account.user.email} · ${modes} · ${left}`);
	} catch (error) {
		setStatus(
			error instanceof ApiError
				? `Failed: ${error.message}`
				: "Failed: could not reach the API.",
		);
	}
}

async function disconnect(): Promise<void> {
	if (!window.confirm("Remove the API URL and key from this browser?")) return;
	await clearConnection();
	await refresh();
}

async function refreshLegacy(): Promise<void> {
	const legacy = await findLegacyProviderKeys();
	const panel = document.getElementById("legacy-keys");
	const detail = document.getElementById("legacy-keys-detail");
	if (!panel) return;
	panel.hidden = !legacy.present;
	if (detail && legacy.present) {
		const names = legacy.providers
			.map((provider) => PROVIDER_LABELS[provider] ?? provider)
			.join(" and ");
		detail.textContent = `Your ${names} key${legacy.providers.length === 1 ? "" : "s"} from the previous version are still in this browser profile. Nothing reads them any more — provider keys now live on your account, under Provider keys in the web app.`;
	}
}

async function removeLegacy(): Promise<void> {
	await clearLegacyProviderKeys();
	await refreshLegacy();
}

function setStatus(message: string): void {
	const node = document.getElementById("connection-status");
	if (node) node.textContent = message;
}
