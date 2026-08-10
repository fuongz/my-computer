/** Deterministic storage-boundary check; no browser profile or real key needed. */

const local: Record<string, unknown> = {};
const sync: Record<string, unknown> = {};

function area(backing: Record<string, unknown>) {
	return {
		async get(keys?: string | string[]) {
			const wanted = keys === undefined ? Object.keys(backing) : Array.isArray(keys) ? keys : [keys];
			return Object.fromEntries(wanted.flatMap((key) => (key in backing ? [[key, backing[key]]] : [])));
		},
		async set(items: Record<string, unknown>) {
			Object.assign(backing, items);
		},
		async remove(keys: string | string[]) {
			for (const key of Array.isArray(keys) ? keys : [keys]) delete backing[key];
		},
	};
}

Object.assign(globalThis, {
	chrome: { storage: { local: area(local), sync: area(sync) } },
});

const {
	CONNECTION_STORAGE_KEY,
	clearConnection,
	getConnection,
	getConnectionStatus,
	normalizeBaseUrl,
	saveConnection,
	setSync,
} = await import("../src/common/connection");
const { LEGACY_API_KEYS_STORAGE_KEY, clearLegacyProviderKeys, findLegacyProviderKeys } =
	await import("../src/common/legacy-keys");

// ── the URL is normalised, and nonsense is refused before it is stored ───────────
assert(normalizeBaseUrl("https://api.test/") === "https://api.test", "a trailing slash is trimmed");
assert(normalizeBaseUrl("  https://api.test  ") === "https://api.test", "whitespace is trimmed");
assert(await rejects(() => normalizeBaseUrl("api.test")), "a bare host is refused");
assert(await rejects(() => normalizeBaseUrl("ftp://api.test")), "a non-http scheme is refused");
assert(await rejects(() => normalizeBaseUrl("")), "an empty URL is refused");

// ── nothing is usable until both halves are present ─────────────────────────────
assert((await getConnection()) === null, "an unconfigured extension has no connection");
assert(await rejects(() => saveConnection({ apiBaseUrl: "https://api.test" })), "a URL with no key is refused");

await saveConnection({ apiBaseUrl: "https://api.test/", apiKey: "fz_secret_value_9876" });
const connection = await getConnection();
assert(connection !== null, "a saved URL and key make a connection");
assert(connection?.apiBaseUrl === "https://api.test", "the stored URL is the normalised one");
assert(connection?.sync === false, "syncing is off until it is asked for");

// ── status is shown, the key is not ─────────────────────────────────────────────
const status = await getConnectionStatus();
assert(status.configured, "status reports being connected");
assert(status.keySuffix === "9876", "status carries only the last four characters");
assert(
	!JSON.stringify(status).includes("fz_secret_value"),
	"status never exposes the key text",
);
assert(Object.keys(sync).length === 0, "the key never reaches Chrome sync storage");
assert(CONNECTION_STORAGE_KEY in local, "the connection is written to local storage");

// ── changing the URL keeps the key; the toggle keeps both ───────────────────────
await saveConnection({ apiBaseUrl: "https://other.test" });
assert(
	(await getConnection())?.apiKey === "fz_secret_value_9876",
	"changing the URL does not require re-pasting the key",
);
await setSync(true);
const synced = await getConnection();
assert(synced?.sync === true, "the sync switch persists");
assert(synced?.apiKey === "fz_secret_value_9876", "and does not disturb the key");

await clearConnection();
assert((await getConnection()) === null, "disconnecting removes the connection");

// ── old provider keys are found, reported, and only removed when asked ──────────
local[LEGACY_API_KEYS_STORAGE_KEY] = { openrouter: "old-openrouter", replicate: "" };
const legacy = await findLegacyProviderKeys();
assert(legacy.present, "keys from the previous version are noticed");
assert(
	legacy.providers.length === 1 && legacy.providers[0] === "openrouter",
	"only providers that actually hold a value are named",
);
assert(
	LEGACY_API_KEYS_STORAGE_KEY in local,
	"finding them does not delete them — that is the user's call",
);

await clearLegacyProviderKeys();
assert(!(await findLegacyProviderKeys()).present, "removing them clears the record");

console.log("Connection storage checks passed");

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** True when the call threw, which is what "refused" means here. */
async function rejects(run: () => unknown): Promise<boolean> {
	try {
		await run();
		return false;
	} catch {
		return true;
	}
}
