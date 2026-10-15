/*
 * Offline checks for Instagram Full Size's pure half: the zip writer, the
 * shortcode arithmetic, and the media-info parser.
 *
 *   bun run check:instagram
 *
 * Nothing here opens instagram.com or a browser. The page-facing half — the
 * button finding the photo under the pointer, the menu, the lightbox, and the
 * media-info request itself — needs a signed-in Instagram tab and a human, so
 * it is left to Load unpacked.
 *
 * The zip is checked by the system's own `unzip` and `tar`, not by reading it
 * back with the code that wrote it: an archive that only this file understands
 * is not an archive.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zipStore } from "../src/common/zip";
import {
	assetKey,
	imageFileName,
	largestFromSrcset,
	parseMediaInfo,
	shortcodeToMediaId,
	zipFileName,
} from "../src/tools/instagram-full-size/media";

let failures = 0;

function ok(label: string, pass: boolean, detail = ""): void {
	if (!pass) failures++;
	console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
}

/* --- the zip ----------------------------------------------------------- */

console.log("\n  the zip writer");

ok(
	"CRC-32 of '123456789' is the standard check value",
	crc32(new TextEncoder().encode("123456789")) === 0xcbf43926,
	crc32(new TextEncoder().encode("123456789")).toString(16),
);

const photo = new Uint8Array(300_000);
for (let i = 0; i < photo.length; i++) photo[i] = (i * 7919) & 0xff;
const entries = [
	{ name: "someone_CxYz_1.jpg", data: photo },
	{ name: "someone_CxYz_3.jpg", data: new TextEncoder().encode("third slide") },
	{ name: "ảnh_đẹp.webp", data: new Uint8Array(0) },
];

const dir = await mkdtemp(join(tmpdir(), "fz-ig-check-"));
try {
	const archive = join(dir, "test.zip");
	await writeFile(archive, zipStore(entries));

	const test = Bun.spawnSync(["unzip", "-t", archive]);
	const report = test.stdout.toString();
	ok("unzip -t finds no errors", test.exitCode === 0 && report.includes("No errors"), report.trim().split("\n").pop());

	// Listed by bsdtar rather than unzip: Info-ZIP's 6.00 builds ignore the
	// UTF-8 flag and print the name as CP437, whatever the archive says.
	const listing = Bun.spawnSync(["tar", "-tf", archive]).stdout.toString().trim().split("\n");
	ok(
		"every entry is listed, UTF-8 names intact",
		// NFC on both sides: macOS hands file names back decomposed.
		listing.length === 3 &&
			entries.every((entry, i) => listing[i]?.normalize("NFC") === entry.name.normalize("NFC")),
		listing.join(", "),
	);

	const back = Bun.spawnSync(["unzip", "-p", archive, "someone_CxYz_1.jpg"]).stdout;
	ok(
		"a file comes back byte for byte",
		back.length === photo.length && back.every((byte, i) => byte === photo[i]),
		`${back.length} bytes`,
	);
} finally {
	await rm(dir, { recursive: true, force: true });
}

/* --- the shortcode ----------------------------------------------------- */

console.log("\n  shortcode → media id");

// The worked examples from instagrapi's documentation of media_pk_from_code.
ok("a public post's shortcode", shortcodeToMediaId("B-fKL9qpeab") === "2278584739065882267");
ok(
	"a private post's long shortcode decodes its first 11 characters only",
	shortcodeToMediaId("B8jnuB2HAbyc0q1nLB7jPu_jAOSxXSpY9XFxi60") === "2243811726252050162",
);
ok("a character outside the alphabet is refused", shortcodeToMediaId("abc!def") === null);
ok("an empty shortcode is refused", shortcodeToMediaId("") === null);

/* --- the media-info answer --------------------------------------------- */

console.log("\n  media-info parsing");

const cdn = (file: string, size: number) =>
	`https://scontent-sin6-1.cdninstagram.com/v/t51.29350-15/${file}?stp=dst-jpg_e35_p${size}x${size}&_nc_ht=x`;

const candidates = (file: string) => ({
	candidates: [
		{ url: cdn(file, 640), width: 640, height: 800 },
		{ url: cdn(file, 1440), width: 1440, height: 1800 },
		{ url: cdn(file, 1080), width: 1080, height: 1350 },
	],
});

const single = parseMediaInfo({
	items: [{ code: "CxSingle123", media_type: 1, user: { username: "someone" }, image_versions2: candidates("111_n.jpg") }],
});
ok("a single photo is one image", single?.items.length === 1 && single.items[0]?.kind === "image");
ok("its largest candidate wins, wherever it is in the list", single?.items[0]?.width === 1440);
ok("username and shortcode come through", single?.username === "someone" && single.shortcode === "CxSingle123");

const carousel = parseMediaInfo({
	items: [
		{
			code: "CxCarousel1",
			media_type: 8,
			user: { username: "someone" },
			carousel_media: [
				{ media_type: 1, image_versions2: candidates("aaa_n.jpg") },
				{ media_type: 2, image_versions2: candidates("bbb_n.jpg"), video_versions: [{ url: "x.mp4" }] },
				{ media_type: 1, image_versions2: candidates("ccc_n.jpg") },
			],
		},
	],
});
ok("a carousel keeps every slide, in order", carousel?.items.map((item) => item.key).join() === "aaa_n.jpg,bbb_n.jpg,ccc_n.jpg");
ok("its video slide is marked as one", carousel?.items[1]?.kind === "video");
ok(
	"a 1080px <img> on screen matches its 1440px original by file name",
	carousel?.items.findIndex((item) => item.key === assetKey(cdn("ccc_n.jpg", 1080))) === 2,
);

ok("an answer with no items is no post", parseMediaInfo({ items: [] }) === null);
ok("an answer of the wrong shape is no post, not an exception", parseMediaInfo("<html>") === null);
ok(
	"a slide without usable candidates is dropped, not fatal",
	parseMediaInfo({ items: [{ code: "C1", carousel_media: [{ media_type: 1 }, { media_type: 1, image_versions2: candidates("d_n.jpg") }] }] })
		?.items.length === 1,
);

/* --- names and fallbacks ----------------------------------------------- */

console.log("\n  file names and the srcset fallback");

ok("a slide's file name", imageFileName("some.one", "CxYz", 3, cdn("x_n.jpg", 1440)) === "some.one_CxYz_3.jpg");
ok("an unplaced slide drops its number", imageFileName("someone", "CxYz", null, cdn("x_n.webp", 1440)) === "someone_CxYz.webp");
ok("path characters never reach a file name", imageFileName("../evil/", "Cx", 1, cdn("x_n.jpg", 1)) === ".._evil__Cx_1.jpg");
ok("the zip's name", zipFileName("someone", "CxYz") === "someone_CxYz.zip");
ok(
	"the widest srcset candidate is picked",
	largestFromSrcset("a.jpg 640w, c.jpg 1080w, b.jpg 750w", "src.jpg") === "c.jpg",
);
ok("an empty srcset falls back to src", largestFromSrcset("", "src.jpg") === "src.jpg");

console.log(failures ? `\n  ${failures} failed\n` : "\n  all passed\n");
process.exit(failures ? 1 : 0);
