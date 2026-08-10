/**
 * The provider keys this extension used to hold, and no longer reads.
 *
 * They are not deleted on upgrade. Silently removing a secret somebody pasted is a
 * decision that belongs to them: the Options page says where those keys live now and
 * offers to clear them, and until it is taken they sit untouched.
 */
export const LEGACY_API_KEYS_STORAGE_KEY = "fz.api-keys.v1";

const LEGACY_PROVIDERS = ["openrouter", "replicate"] as const;

export interface LegacyKeys {
	present: boolean;
	/** Provider names that still have a value stored, for naming them in the notice. */
	providers: string[];
}

export async function findLegacyProviderKeys(): Promise<LegacyKeys> {
	const result = await chrome.storage.local.get(LEGACY_API_KEYS_STORAGE_KEY);
	const value = result[LEGACY_API_KEYS_STORAGE_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { present: false, providers: [] };
	}
	const source = value as Record<string, unknown>;
	const providers = LEGACY_PROVIDERS.filter(
		(provider) => typeof source[provider] === "string" && source[provider] !== "",
	);
	return { present: providers.length > 0, providers: [...providers] };
}

export async function clearLegacyProviderKeys(): Promise<void> {
	await chrome.storage.local.remove(LEGACY_API_KEYS_STORAGE_KEY);
}
