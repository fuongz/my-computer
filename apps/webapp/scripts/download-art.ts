/**
 * Downloads every hero and skin picture into `public/mlbb/`, so the app serves its
 * own artwork instead of hotlinking Fandom's CDN.
 *
 *   bun run data:art          # standalone; `data:sync` also calls it at the end
 *
 * One file per catalogue row, named after the row's id — `public/mlbb/181.webp` is
 * Layla's default skin. That is the whole naming rule, which is why `images.ts` needs
 * no lookup table and the dataset needs no extra field.
 *
 * Everything is fetched at `scale-to-width-down/320`, which is the widest a tile is
 * ever drawn on a 2× screen. The CDN transcodes to WebP on the way out regardless of
 * whether the original is a JPG or a PNG, so every file lands with the same extension.
 *
 * Already-downloaded files are skipped, so a re-run after `data:sync` only fetches
 * what is new. Delete the folder to force a full refresh.
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import type { Hero, Skin } from "#/tools/mlbb/types.ts";
import heroes from "#/tools/mlbb/data/heroes.json";
import skins from "#/tools/mlbb/data/skins.json";

const CDN = "https://static.wikia.nocookie.net/mobile-legends/images/";
const WIDTH = 320;
const CONCURRENCY = 12;

const HEADERS = {
	"User-Agent":
		"fuongz-webapp-data-sync/0.1 (+https://github.com/fuongz/my-computer)",
};

const OUT = new URL("../public/mlbb/", import.meta.url);

export async function downloadArt(): Promise<{
	written: number;
	skipped: number;
	bytes: number;
}> {
	await mkdir(OUT, { recursive: true });
	const present = new Set(await readdir(OUT).catch(() => []));

	// `splash ?? icon` is exactly what the tile draws, so it is exactly what is worth
	// storing — the icon of a skin that has splash art would be a file nothing loads.
	//
	// Deduped by id, and that is not a safety net: a hero's id IS its default skin's
	// id, so those 133 rows are 133 pairs pointing at one picture. 1140 rows become
	// 1007 files, which is the right number, not a shortfall.
	//
	// Every id is re-checked here even though `sync-mlbb-data.ts` already refuses a
	// non-numeric one. This is the step that turns an id into a path, and the dataset
	// on disk may predate that guard or have been edited by hand — so the check lives
	// where the damage would happen, not only where the data came in.
	const wanted = [
		...new Map(
			[...(heroes as unknown as Hero[]), ...(skins as unknown as Skin[])]
				.filter((row) => {
					if (/^[0-9]+$/.test(row.id)) return true;
					console.error(
						`  skipped ${JSON.stringify(row.id)}: an id becomes a filename, and ` +
							`this one is not digits-only. Re-run \`bun run data:sync\` to ` +
							`regenerate the dataset.`,
					);
					return false;
				})
				.map((row) => [
					row.id,
					{ id: row.id, segment: row.splash ?? row.icon },
				]),
		).values(),
	];

	const todo = wanted.filter((row) => !present.has(`${row.id}.webp`));
	const skipped = wanted.length - todo.length;
	let written = 0;
	let bytes = 0;
	let failed = 0;

	// A fixed pool rather than `Promise.all` over 1140 fetches: the CDN is somebody
	// else's, and opening a thousand sockets at once is how a polite script becomes a
	// rude one.
	const queue = todo.slice();
	await Promise.all(
		Array.from({ length: CONCURRENCY }, async () => {
			for (let row = queue.pop(); row; row = queue.pop()) {
				const url = `${CDN}${row.segment}/revision/latest/scale-to-width-down/${WIDTH}`;
				try {
					const res = await fetch(url, { headers: HEADERS });
					if (!res.ok) throw new Error(`${res.status}`);
					const buffer = await res.arrayBuffer();
					await Bun.write(new URL(`${row.id}.webp`, OUT), buffer);
					written += 1;
					bytes += buffer.byteLength;
				} catch (error) {
					failed += 1;
					console.error(
						`  ${row.id}: ${error instanceof Error ? error.message : error}`,
					);
				}
				if ((written + failed) % 100 === 0) {
					process.stdout.write(`\r  ${written + failed}/${todo.length}`);
				}
			}
		}),
	);
	if (todo.length) process.stdout.write("\n");

	if (failed) {
		throw new Error(
			`${failed} image(s) failed. Re-run to retry only those — successful ones are skipped.`,
		);
	}
	return { written, skipped, bytes };
}

/** Total bytes on disk, so the repo cost of this folder is never a surprise. */
export async function artSize(): Promise<number> {
	const files = await readdir(OUT).catch(() => []);
	const sizes = await Promise.all(
		files.map((file) =>
			stat(new URL(file, OUT)).then(
				(s) => s.size,
				() => 0,
			),
		),
	);
	return sizes.reduce((total, size) => total + size, 0);
}

if (import.meta.main) {
	console.log(`Downloading artwork into public/mlbb/ at ${WIDTH}px …`);
	const { written, skipped, bytes } = await downloadArt();
	console.log(
		`Wrote ${written} file(s) (${(bytes / 1e6).toFixed(1)} MB), skipped ${skipped} already present. ` +
			`Folder is now ${((await artSize()) / 1e6).toFixed(1)} MB.`,
	);
}
