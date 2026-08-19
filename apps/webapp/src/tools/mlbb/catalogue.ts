import heroesJson from "./data/heroes.json";
import metaJson from "./data/meta.json";
import skinsJson from "./data/skins.json";
import type { CatalogueMeta, Hero, Skin } from "./types.ts";

/**
 * The catalogue, and the few indexes every view wants.
 *
 * The `as unknown as` casts are the one place this app trusts a file instead of a
 * type. What makes them safe is `scripts/sync-mlbb-data.ts`, which validates every
 * role, lane, tier and availability value against the unions in `types.ts` and
 * refuses to write a file that would violate them — so the check happens once, at
 * generation, rather than on every page load in the browser.
 */
export const heroes = heroesJson as unknown as Hero[];
export const skins = skinsJson as unknown as Skin[];
export const meta = metaJson as CatalogueMeta;

export const heroByName = new Map(heroes.map((hero) => [hero.name, hero]));

export const skinsByHero = skins.reduce((acc, skin) => {
	const list = acc.get(skin.hero);
	if (list) list.push(skin);
	else acc.set(skin.hero, [skin]);
	return acc;
}, new Map<string, Skin[]>());

/**
 * Every skin tag, commonest first.
 *
 * There are over a hundred and the tail is one-offs (`M5`, `S27`, `MSC 2018`), so a
 * filter that shows them alphabetically buries StarLight and Collector under season
 * numbers. Frequency order puts the ones worth filtering by at the top.
 */
export const tags: { tag: string; count: number }[] = [
	...skins
		.reduce((acc, skin) => {
			if (skin.tag) acc.set(skin.tag, (acc.get(skin.tag) ?? 0) + 1);
			return acc;
		}, new Map<string, number>())
		.entries(),
]
	.map(([tag, count]) => ({ tag, count }))
	.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
