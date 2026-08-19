import { create } from "zustand";
import { persist } from "zustand/middleware";
import { heroes, skins } from "./catalogue.ts";

/**
 * What the user owns. The whole tool's state, and it never leaves the browser.
 *
 * Ownership of a hero and of its skins are separate sets on purpose: the game lets a
 * skin sit in a collection for a hero you have not unlocked, so deriving one from the
 * other would mean the page reporting an account you do not have.
 *
 * Stored as `Record<id, true>` rather than a `Set` because `persist` writes JSON —
 * a Set would need a custom serializer to survive a reload, and this would not be the
 * first collection tracker to lose everything to one.
 */

export const STORAGE_KEY = "mlbb-collection";
const EXPORT_FORMAT = "fuongz-webapp/mlbb-collection";
const EXPORT_VERSION = 1;

type Owned = Record<string, true>;

interface CollectionState {
	heroes: Owned;
	skins: Owned;
	/**
	 * False until `persist` has read localStorage. Rehydration is deferred (see
	 * `skipHydration` below) so the first client render matches the server's, and
	 * every view uses this to show a skeleton rather than a confident "0 owned".
	 */
	hydrated: boolean;
	toggleHero: (id: string) => void;
	toggleSkin: (id: string) => void;
	/** Bulk set, for "mark every filtered skin as owned". */
	setSkins: (ids: string[], owned: boolean) => void;
	setHeroes: (ids: string[], owned: boolean) => void;
	reset: () => void;
	replace: (next: { heroes: string[]; skins: string[] }) => void;
}

function toggle(map: Owned, id: string): Owned {
	if (map[id]) {
		const { [id]: _removed, ...rest } = map;
		return rest;
	}
	return { ...map, [id]: true };
}

function setAll(map: Owned, ids: string[], owned: boolean): Owned {
	const next = { ...map };
	for (const id of ids) {
		if (owned) next[id] = true;
		else delete next[id];
	}
	return next;
}

function listOf(ids: string[]): Owned {
	return Object.fromEntries(ids.map((id) => [id, true as const]));
}

export const useCollection = create<CollectionState>()(
	persist(
		(set) => ({
			heroes: {},
			skins: {},
			hydrated: false,
			toggleHero: (id) => set((s) => ({ heroes: toggle(s.heroes, id) })),
			toggleSkin: (id) => set((s) => ({ skins: toggle(s.skins, id) })),
			setSkins: (ids, owned) =>
				set((s) => ({ skins: setAll(s.skins, ids, owned) })),
			setHeroes: (ids, owned) =>
				set((s) => ({ heroes: setAll(s.heroes, ids, owned) })),
			reset: () => set({ heroes: {}, skins: {} }),
			replace: (next) =>
				set({ heroes: listOf(next.heroes), skins: listOf(next.skins) }),
		}),
		{
			name: STORAGE_KEY,
			version: EXPORT_VERSION,
			// Only the two sets are persisted; `hydrated` is a fact about this page load.
			partialize: (s) => ({ heroes: s.heroes, skins: s.skins }),
			// The page is server-rendered, and localStorage does not exist there. Without
			// this, the first client render would already hold the stored collection while
			// the server's HTML said nothing was owned — a hydration mismatch on every
			// visit. `hydrate()` in the tool route does the read instead, one tick later.
			skipHydration: true,
		},
	),
);

/**
 * Reads localStorage and flips `hydrated`. Call once, from an effect.
 *
 * Safe to call twice — React runs effects twice under dev StrictMode, and `persist`
 * re-reading the same storage lands on the same state. `hydrated` is set after the
 * read, not before, so no view can render a total it has not actually loaded.
 */
export async function hydrateCollection() {
	await useCollection.persist.rehydrate();
	useCollection.setState({ hydrated: true });
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export interface CollectionFile {
	format: typeof EXPORT_FORMAT;
	version: number;
	exportedAt: string;
	heroes: string[];
	skins: string[];
}

export function exportCollection(): CollectionFile {
	const { heroes: ownedHeroes, skins: ownedSkins } = useCollection.getState();
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		heroes: Object.keys(ownedHeroes).sort(),
		skins: Object.keys(ownedSkins).sort(),
	};
}

export interface ImportResult {
	heroes: number;
	skins: number;
	/** Ids in the file that no longer exist in the catalogue, and were dropped. */
	unknown: number;
}

/**
 * Replaces the collection with a previously exported file.
 *
 * Ids the current catalogue does not know are dropped rather than kept — a skin the
 * wiki has since renamed would otherwise sit in storage forever, counted in the total
 * but impossible to see or untick. How many were dropped is returned, not swallowed.
 */
export function importCollection(raw: unknown): ImportResult {
	if (typeof raw !== "object" || raw === null) {
		throw new Error("Tệp không phải JSON hợp lệ.");
	}
	const file = raw as Partial<CollectionFile>;
	if (file.format !== EXPORT_FORMAT) {
		throw new Error(
			"Tệp này không phải bản sao lưu bộ sưu tập Mobile Legends của webapp.",
		);
	}
	if (!Array.isArray(file.heroes) || !Array.isArray(file.skins)) {
		throw new Error("Tệp thiếu danh sách tướng hoặc trang phục.");
	}

	const knownHeroes = new Set(heroes.map((hero) => hero.id));
	const knownSkins = new Set(skins.map((skin) => skin.id));
	const heroIds = file.heroes.filter(
		(id): id is string => typeof id === "string" && knownHeroes.has(id),
	);
	const skinIds = file.skins.filter(
		(id): id is string => typeof id === "string" && knownSkins.has(id),
	);

	useCollection.getState().replace({ heroes: heroIds, skins: skinIds });

	return {
		heroes: heroIds.length,
		skins: skinIds.length,
		unknown:
			file.heroes.length -
			heroIds.length +
			(file.skins.length - skinIds.length),
	};
}
