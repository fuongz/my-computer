/*
 * The pure half of the tool: no DOM, no chrome.*, so scripts/check-instagram.ts
 * can run all of it offline.
 *
 * Instagram's page knows a post by its shortcode — the `CxYz…` in /p/CxYz…/ —
 * but the endpoint that lists a post's full-size images wants the numeric media
 * id. The shortcode *is* that id, written in a URL-safe base-64 alphabet, so
 * the conversion is arithmetic rather than another request.
 */

/** Instagram's shortcode alphabet: base64url, in its usual order. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A public post's shortcode is 11 characters. A private account's post links
 * with a longer one, whose first 11 are the same id and whose tail is not part
 * of it — so only the head is decoded.
 */
const SHORTCODE_ID_LENGTH = 11;

export function shortcodeToMediaId(shortcode: string): string | null {
	const head = shortcode.slice(0, SHORTCODE_ID_LENGTH);
	if (!head) return null;

	let id = 0n;
	for (const char of head) {
		const digit = ALPHABET.indexOf(char);
		if (digit < 0) return null;
		id = id * 64n + BigInt(digit);
	}
	return id.toString();
}

/** One slide of a post, as far as this tool cares about it. */
export interface MediaItem {
	kind: "image" | "video";
	/** The largest image Instagram offers — for a video, its cover frame. */
	url: string;
	width: number;
	height: number;
	/**
	 * The CDN file name, which every size of the same image shares — sizes
	 * differ in the query string, not the path. It is how the image under the
	 * pointer is matched to its slide.
	 */
	key: string;
}

export interface Post {
	shortcode: string;
	username: string;
	/** Every slide, in order; a single-image post has one. */
	items: MediaItem[];
}

/** Instagram's media type numbers. 8 is a carousel; its slides are 1 or 2. */
const MEDIA_VIDEO = 2;

/**
 * Turns a `/api/v1/media/{id}/info/` response into a {@link Post}. Every field
 * is checked rather than trusted: this is an undocumented endpoint, and the
 * day it changes shape should read as "no post", not as a thrown error.
 */
export function parseMediaInfo(json: unknown): Post | null {
	const item = first(field(json, "items"));
	if (!isRecord(item)) return null;

	const shortcode = item["code"];
	if (typeof shortcode !== "string" || !shortcode) return null;

	const username = field(item["user"], "username");

	const slides = field(item, "carousel_media");
	const sources = Array.isArray(slides) && slides.length > 0 ? slides : [item];

	const items: MediaItem[] = [];
	for (const source of sources) {
		const parsed = parseSlide(source);
		if (parsed) items.push(parsed);
	}
	if (items.length === 0) return null;

	return {
		shortcode,
		username: typeof username === "string" && username ? username : "instagram",
		items,
	};
}

function parseSlide(source: unknown): MediaItem | null {
	if (!isRecord(source)) return null;

	const candidates = field(source["image_versions2"], "candidates");
	if (!Array.isArray(candidates)) return null;

	let best: { url: string; width: number; height: number } | null = null;
	for (const candidate of candidates) {
		if (!isRecord(candidate)) continue;
		const { url, width, height } = candidate;
		if (typeof url !== "string" || typeof width !== "number" || typeof height !== "number") {
			continue;
		}
		if (!best || width * height > best.width * best.height) best = { url, width, height };
	}
	if (!best) return null;

	return {
		kind: source["media_type"] === MEDIA_VIDEO ? "video" : "image",
		...best,
		key: assetKey(best.url),
	};
}

/** The CDN path's last segment: the same for every size of one image. */
export function assetKey(url: string): string {
	try {
		return new URL(url).pathname.split("/").pop() ?? "";
	} catch {
		return "";
	}
}

/**
 * The widest candidate in an `<img srcset>`, for when the media-info request
 * fails: smaller than the original, but still the best the page already has.
 */
export function largestFromSrcset(srcset: string, fallback: string): string {
	let best = fallback;
	let bestWidth = 0;
	for (const entry of srcset.split(",")) {
		const [url, descriptor] = entry.trim().split(/\s+/);
		const width = Number.parseInt(descriptor ?? "", 10);
		if (url && width > bestWidth) {
			best = url;
			bestWidth = width;
		}
	}
	return best;
}

/**
 * `{username}_{shortcode}_{n}.{ext}`, n counting slides from 1 so the file
 * matches the dot it came from, videos skipped or not. `null` drops the `_{n}`:
 * the image could not be placed in its post, and a wrong number is worse than
 * none. The extension comes from the CDN path — Instagram serves JPEG almost
 * always, WebP or HEIC sometimes.
 */
export function imageFileName(
	username: string,
	shortcode: string,
	slide: number | null,
	url: string,
): string {
	const ext = /\.(jpe?g|png|webp|heic)$/i.exec(assetKey(url))?.[1]?.toLowerCase() ?? "jpg";
	const n = slide === null ? "" : `_${slide}`;
	return `${safe(username)}_${safe(shortcode)}${n}.${ext}`;
}

export function zipFileName(username: string, shortcode: string): string {
	return `${safe(username)}_${safe(shortcode)}.zip`;
}

/** Usernames and shortcodes are already this alphabet; anything else is not trusted into a path. */
function safe(part: string): string {
	return part.replace(/[^A-Za-z0-9._-]/g, "_") || "instagram";
}

function field(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined;
}

function first(value: unknown): unknown {
	return Array.isArray(value) ? value[0] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
