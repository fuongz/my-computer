/**
 * How this extension reaches the generation API.
 *
 * One URL and one key replace the two provider credentials this file used to hold.
 * Still `chrome.storage.local` and still never Chrome-synced — a key that syncs is a
 * key on every machine the profile has ever touched.
 */
export const CONNECTION_STORAGE_KEY = "fz.connection.v1";

export interface Connection {
	/** No trailing slash, so every call site can concatenate a path safely. */
	apiBaseUrl: string;
	apiKey: string;
	/** Whether the API should retain each generation in the web app. */
	sync: boolean;
}

export interface ConnectionStatus {
	configured: boolean;
	apiBaseUrl: string;
	/** A non-sensitive identifier only; never the full key. */
	keySuffix?: string;
	sync: boolean;
}

/** Rejects anything that is not an absolute http(s) origin, and trims the slash. */
export function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) throw new Error("Enter the API base URL.");
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("The API base URL must be a full URL, e.g. https://api.example.com");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("The API base URL must start with http:// or https://");
	}
	return trimmed;
}

/** Null until both halves are present — there is no useful half-configured state. */
export async function getConnection(): Promise<Connection | null> {
	const record = await read();
	if (!record.apiBaseUrl || !record.apiKey) return null;
	return { apiBaseUrl: record.apiBaseUrl, apiKey: record.apiKey, sync: record.sync };
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
	const record = await read();
	return {
		configured: Boolean(record.apiBaseUrl && record.apiKey),
		apiBaseUrl: record.apiBaseUrl,
		...(record.apiKey ? { keySuffix: record.apiKey.slice(-4) } : {}),
		sync: record.sync,
	};
}

/** An omitted key keeps the stored one, so changing the URL is not a re-paste. */
export async function saveConnection(input: {
	apiBaseUrl: string;
	apiKey?: string;
}): Promise<void> {
	const record = await read();
	const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : record.apiKey;
	if (!apiKey) throw new Error("Enter your API key.");
	await write({ ...record, apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl), apiKey });
}

export async function setSync(sync: boolean): Promise<void> {
	await write({ ...(await read()), sync });
}

export async function clearConnection(): Promise<void> {
	await chrome.storage.local.remove(CONNECTION_STORAGE_KEY);
}

async function read(): Promise<Connection> {
	const result = await chrome.storage.local.get(CONNECTION_STORAGE_KEY);
	const value = result[CONNECTION_STORAGE_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { apiBaseUrl: "", apiKey: "", sync: false };
	}
	const source = value as Record<string, unknown>;
	return {
		apiBaseUrl: typeof source.apiBaseUrl === "string" ? source.apiBaseUrl : "",
		apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
		sync: source.sync === true,
	};
}

async function write(connection: Connection): Promise<void> {
	await chrome.storage.local.set({ [CONNECTION_STORAGE_KEY]: connection });
}
