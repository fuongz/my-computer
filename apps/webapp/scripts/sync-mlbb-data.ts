/**
 * Regenerates the Mobile Legends catalogue under `src/tools/mlbb/data/`.
 *
 *   bun run data:sync
 *
 * The MLBB Fandom wiki keeps its structured data in two Lua modules — `Module:Hero/data`
 * and `Module:Skin/data` — which are plain `return { … }` tables. This fetches both,
 * parses them, resolves every icon and splash-art file to a Wikia CDN path, and writes
 * three JSON files the app imports directly.
 *
 * Why bake it instead of fetching at runtime: the app then has no dependency on Fandom
 * being up, no Lua parser on the Worker, and no cold-start latency. The cost is that the
 * data is only as fresh as the last run of this script — which is why `meta.json` records
 * when that was, and the tool shows it.
 */

import { AVAILABILITY, LANES, ROLES, TIERS } from "#/tools/mlbb/types.ts";

const WIKI = "https://mobile-legends.fandom.com/api.php";

// Fandom answers an anonymous request with 403. Identify the script and who runs it —
// that is the condition of using the API, not a way around a block.
const HEADERS = {
	"User-Agent":
		"fuongz-webapp-data-sync/0.1 (+https://github.com/fuongz/my-computer)",
};

/** Every image URL shares this prefix; only the path segment is stored per row. */
const CDN = "https://static.wikia.nocookie.net/mobile-legends/images/";

const OUT = new URL("../src/tools/mlbb/data/", import.meta.url);

// ---------------------------------------------------------------------------
// Lua
// ---------------------------------------------------------------------------

type LuaValue = string | number | boolean | null | LuaTable | LuaValue[];
interface LuaTable {
	[key: string]: LuaValue;
}

const TOKEN =
	/(?<ws>\s+|--\[\[[\s\S]*?\]\]|--[^\n]*)|(?<key>\[\s*"(?:[^"\\]|\\.)*"\s*\]|\[\s*'(?:[^'\\]|\\.)*'\s*\]|\[\s*-?\d+\s*\]|[A-Za-z_]\w*)\s*=|(?<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<num>-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|(?<bool>\btrue\b|\bfalse\b)|(?<nil>\bnil\b)|(?<punc>[{},])/y;

type Token = { kind: string; text: string };

function tokenize(src: string): Token[] {
	const out: Token[] = [];
	TOKEN.lastIndex = 0;
	while (TOKEN.lastIndex < src.length) {
		const at = TOKEN.lastIndex;
		const m = TOKEN.exec(src);
		if (!m?.groups) {
			throw new Error(`Lua: unparsable at ${at}: ${src.slice(at, at + 60)}`);
		}
		const kind = Object.keys(m.groups).find((k) => m.groups?.[k] !== undefined);
		if (!kind || kind === "ws") continue;
		out.push({ kind, text: m[0] });
	}
	return out;
}

/** `["name"]` → `name`, `"x"` → `x`, and the Lua escapes that actually occur. */
function unquote(raw: string): string {
	let s = raw.trim();
	if (s.startsWith("[")) s = s.slice(1, -1).trim();
	if (s.startsWith('"') || s.startsWith("'")) {
		s = s.slice(1, -1);
	}
	return s.replace(/\\(["'\\n])/g, (_, c) => (c === "n" ? "\n" : c));
}

function parseValue(tokens: Token[], i: number): [LuaValue, number] {
	const tok = tokens[i];
	if (!tok) throw new Error("Lua: unexpected end of input");

	if (tok.kind === "punc" && tok.text === "{") {
		i += 1;
		const dict: LuaTable = {};
		const array: LuaValue[] = [];
		let keyed = false;
		for (;;) {
			const next = tokens[i];
			if (!next) throw new Error("Lua: unterminated table");
			if (next.kind === "punc" && next.text === "}") {
				return [keyed || array.length === 0 ? dict : array, i + 1];
			}
			if (next.kind === "punc" && next.text === ",") {
				i += 1;
				continue;
			}
			if (next.kind === "key") {
				keyed = true;
				const key = unquote(next.text.replace(/\s*=$/, ""));
				const [value, after] = parseValue(tokens, i + 1);
				dict[key] = value;
				i = after;
			} else {
				const [value, after] = parseValue(tokens, i);
				array.push(value);
				i = after;
			}
		}
	}
	if (tok.kind === "str") return [unquote(tok.text), i + 1];
	if (tok.kind === "num") return [Number(tok.text), i + 1];
	if (tok.kind === "bool") return [tok.text === "true", i + 1];
	if (tok.kind === "nil") return [null, i + 1];
	throw new Error(`Lua: unexpected ${tok.kind} ${tok.text}`);
}

function parseLuaModule(src: string): LuaTable {
	const at = src.indexOf("return");
	if (at < 0) throw new Error("Lua: module has no `return`");
	const [value] = parseValue(tokenize(src.slice(at + "return".length)), 0);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Lua: module did not return a table");
	}
	return value;
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

async function wikiJson(params: Record<string, string>): Promise<unknown> {
	const url = new URL(WIKI);
	url.search = new URLSearchParams({ format: "json", ...params }).toString();
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`${url.pathname}${url.search} → ${res.status}`);
	return res.json();
}

async function fetchModule(page: string): Promise<LuaTable> {
	const body = (await wikiJson({
		action: "parse",
		page,
		prop: "wikitext",
	})) as {
		error?: { info: string };
		parse?: { wikitext: { "*": string } };
	};
	if (body.error) throw new Error(`${page}: ${body.error.info}`);
	if (!body.parse) throw new Error(`${page}: no wikitext in response`);
	return parseLuaModule(body.parse.wikitext["*"]);
}

/**
 * File title → CDN path segment, for as many of `titles` as exist.
 *
 * A title the wiki does not have is simply absent from the result; callers decide
 * whether that is fatal. Batched at the API's 50-title limit for anonymous requests.
 */
async function resolveFiles(titles: string[]): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const unique = [...new Set(titles)];

	for (let i = 0; i < unique.length; i += 50) {
		const batch = unique.slice(i, i + 50);
		const body = (await wikiJson({
			action: "query",
			prop: "imageinfo",
			iiprop: "url",
			titles: batch.join("|"),
		})) as {
			query?: {
				pages?: Record<
					string,
					{ title: string; imageinfo?: { url: string }[] }
				>;
			};
		};

		for (const page of Object.values(body.query?.pages ?? {})) {
			const url = page.imageinfo?.[0]?.url;
			if (!url) continue;
			// `…/images/f/f9/Layla_%28Energy_Gunner%29.jpg/revision/latest?cb=…` — keep the
			// middle. The `cb` is a cache-buster we do not need, and `/revision/latest` is
			// re-added at render time along with the size.
			const segment = url.slice(CDN.length).split("/revision/")[0];
			if (segment) found.set(normalizeTitle(page.title), segment);
		}
		process.stdout.write(
			`\r  images ${Math.min(i + 50, unique.length)}/${unique.length}`,
		);
	}
	process.stdout.write("\n");
	return found;
}

/** MediaWiki treats spaces and underscores as the same character in a title. */
function normalizeTitle(title: string): string {
	return title.replace(/ /g, "_");
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function str(table: LuaTable, key: string): string {
	const value = table[key];
	return typeof value === "string" ? value.trim() : "";
}

/** The wiki writes an unset numeric field as `""`; a real 0 never occurs here. */
function num(table: LuaTable, key: string): number | undefined {
	const raw = str(table, key).replace(/,/g, "");
	if (!raw) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

/** `[[MLBB × Star Wars|Star Wars]] event` → `Star Wars event`. */
function stripWikitext(text: string): string {
	return text
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/'{2,}/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function priceOf(table: LuaTable, keys: Record<string, string>) {
	const price: Record<string, number | string> = {};
	for (const [from, to] of Object.entries(keys)) {
		if (to === "other") {
			const prose = stripWikitext(str(table, from));
			if (prose) price.other = prose;
			continue;
		}
		const value = num(table, from);
		if (value !== undefined) price[to] = value;
	}
	return price;
}

function isTable(value: LuaValue | undefined): value is LuaTable {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An id becomes a filename.
 *
 * `download-art.ts` writes `public/mlbb/<id>.webp`, and this module is the only thing
 * standing between that path and a wiki anyone can edit. `new URL("../../x", dir)`
 * resolves outside `dir` quite happily, so an id carrying a slash or a dot segment is
 * an arbitrary write on whoever runs `data:sync`. Digits only, and never empty.
 */
function assertId(kind: string, id: string, context: string): string {
	if (!/^[0-9]+$/.test(id)) {
		throw new Error(
			`${kind} ${context}: id ${JSON.stringify(id)} is not digits-only. ` +
				`Ids become filenames under public/mlbb/, so this is refused rather than ` +
				`written. Check the wiki module — every id there has always been numeric.`,
		);
	}
	return id;
}

/** Throws naming the offending values, so the fix is obvious from the message alone. */
function assertVocabulary(
	field: string,
	allowed: readonly string[],
	seen: string[],
) {
	const known = new Set(allowed);
	const strays = [...new Set(seen.filter((value) => !known.has(value)))];
	if (strays.length) {
		throw new Error(
			`${field}: the wiki now uses ${strays.map((s) => JSON.stringify(s)).join(", ")}, ` +
				`which src/tools/mlbb/types.ts does not list. Add them there (and to the ` +
				`Vietnamese labels in labels.ts) before re-running.`,
		);
	}
}

// ---------------------------------------------------------------------------

async function main() {
	console.log("Fetching Module:Hero/data and Module:Skin/data …");
	const [heroData, skinData] = await Promise.all([
		fetchModule("Module:Hero/data"),
		fetchModule("Module:Skin/data"),
	]);

	// `Module:Hero/data` ships a `Mystery Hero` row whose fields are `<placeholder>`
	// text documenting the table's shape. Rather than pattern-match the placeholders,
	// require the hero to also appear in `Module:Skin/data` — every real hero has at
	// least a default skin there, and the two modules disagreeing is itself worth
	// dropping the row over.
	const heroEntries = Object.entries(heroData).filter(
		([name, row]) => isTable(row) && isTable(skinData[name]),
	) as [string, LuaTable][];

	// A skin's `id` is also the stem of its icon file, and a hero's `id` is the id of
	// its default skin — so one naming rule covers both.
	const iconTitles: string[] = [];
	const splashTitles: string[] = [];
	const splashKeyOf = new Map<string, string[]>();

	for (const [hero, row] of Object.entries(skinData)) {
		if (!isTable(row)) continue;
		const skins = row.skins;
		if (!isTable(skins)) continue;
		for (const skin of Object.values(skins)) {
			if (!isTable(skin)) continue;
			iconTitles.push(`File:Hero${str(skin, "id")}-icon.png`);
			// Splash art carries no id in its name, and the wiki is inconsistent about
			// the extension — so ask for all three and take whichever exists.
			const stem = `${hero} (${str(skin, "name")})`;
			const candidates = ["jpg", "webp", "png"].map(
				(ext) => `File:${stem}.${ext}`,
			);
			splashTitles.push(...candidates);
			splashKeyOf.set(str(skin, "id"), candidates.map(normalizeTitle));
		}
	}

	console.log(`Resolving ${iconTitles.length} icons …`);
	const icons = await resolveFiles(iconTitles);
	console.log(`Resolving splash art for ${splashKeyOf.size} skins …`);
	const splashes = await resolveFiles(splashTitles);

	const splashFor = (skinId: string): string | null => {
		for (const key of splashKeyOf.get(skinId) ?? []) {
			const hit = splashes.get(key);
			if (hit) return hit;
		}
		return null;
	};
	const iconFor = (skinId: string): string => {
		const hit = icons.get(normalizeTitle(`File:Hero${skinId}-icon.png`));
		if (!hit) throw new Error(`no icon for skin ${skinId}`);
		return hit;
	};

	const heroes = heroEntries
		.map(([name, row]) => {
			const id = assertId("hero", str(row, "id"), name);
			return {
				id,
				number: num(row, "number") ?? 0,
				name: str(row, "name") || name,
				title: str(row, "title"),
				roles: [str(row, "role1"), str(row, "role2")].filter(Boolean),
				lanes: [str(row, "lane1"), str(row, "lane2")].filter(Boolean),
				region: str(row, "region"),
				releaseYear: num(row, "release_year") ?? null,
				price: priceOf(row, {
					diamond: "dm",
					bp: "bp",
					ticket: "ticket",
					fragment: "fragment",
					lucky_gem: "lg",
				}),
				icon: iconFor(id),
				splash: splashFor(id),
			};
		})
		.sort((a, b) => a.number - b.number);

	const skins = Object.entries(skinData)
		.flatMap(([hero, row]) => {
			if (!isTable(row) || !isTable(row.skins)) return [];
			return Object.values(row.skins).flatMap((skin) => {
				if (!isTable(skin)) return [];
				const id = assertId("skin", str(skin, "id"), hero);
				return [
					{
						id,
						hero,
						name: str(skin, "name"),
						tier: str(skin, "tier"),
						tag: str(skin, "tag"),
						availability: str(skin, "availability") || "Available",
						release: str(skin, "release"),
						price: priceOf(isTable(skin.price) ? skin.price : {}, {
							dm: "dm",
							bp: "bp",
							ticket: "ticket",
							hf: "fragment",
							lg: "lg",
							other: "other",
						}),
						icon: iconFor(id),
						splash: splashFor(id),
					},
				];
			});
		})
		.sort((a, b) => a.hero.localeCompare(b.hero) || a.id.localeCompare(b.id));

	// `catalogue.ts` casts the JSON straight to the unions in `types.ts` without
	// re-checking. That cast is only honest if this script refuses to write a file
	// that would break it — so a wiki edit introducing a seventh role fails here,
	// loudly, instead of quietly emptying a filter in the browser.
	assertVocabulary(
		"role",
		ROLES,
		heroes.flatMap((h) => h.roles),
	);
	assertVocabulary(
		"lane",
		LANES,
		heroes.flatMap((h) => h.lanes),
	);
	assertVocabulary(
		"tier",
		[...TIERS, ""],
		skins.map((s) => s.tier),
	);
	assertVocabulary(
		"availability",
		AVAILABILITY,
		skins.map((s) => s.availability),
	);

	const meta = {
		syncedAt: new Date().toISOString(),
		heroes: heroes.length,
		skins: skins.length,
		source: "https://mobile-legends.fandom.com",
	};

	await Bun.write(
		new URL("heroes.json", OUT),
		`${JSON.stringify(heroes, null, "\t")}\n`,
	);
	await Bun.write(
		new URL("skins.json", OUT),
		`${JSON.stringify(skins, null, "\t")}\n`,
	);
	await Bun.write(
		new URL("meta.json", OUT),
		`${JSON.stringify(meta, null, "\t")}\n`,
	);

	const withoutSplash = skins.filter((s) => !s.splash).length;
	console.log(
		`Wrote ${heroes.length} heroes and ${skins.length} skins.` +
			(withoutSplash
				? ` ${withoutSplash} skins have no splash art on the wiki and fall back to their icon.`
				: ""),
	);

	// The pictures are part of the dataset, not a separate errand — a sync that left
	// them behind would leave the grid full of broken tiles until somebody remembered
	// a second command. Already-present files are skipped, so this is cheap on a
	// re-sync that only added a hero.
	console.log("\nFetching any new artwork …");
	// Imported HERE, not at the top: `download-art.ts` reads the two JSON files at
	// module load, and a static import would be evaluated before the writes above —
	// so a sync that added a hero would download everything except that hero.
	const { downloadArt, artSize } = await import("./download-art.ts");
	const art = await downloadArt();
	console.log(
		`Wrote ${art.written} image(s), skipped ${art.skipped} already present. ` +
			`public/mlbb/ is now ${((await artSize()) / 1e6).toFixed(1)} MB.`,
	);
}

await main();
