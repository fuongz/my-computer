/*
 * Instagram Full Size's half of the worker: the downloads.
 *
 * The content script finds the URLs; this is where they are fetched and saved,
 * because only here can Chrome name a file the extension downloads, and only
 * here do the CDN host permissions let the image bytes be read for a zip —
 * from the page, the CDN's missing CORS headers would stop that cold.
 *
 * Nothing a message says is taken on trust. The sender has to be an
 * instagram.com page with the tool switched on, every URL has to be https on
 * Instagram's own CDN, and every file name is cut down to a bare, safe name —
 * so the worst a forged message can do is save an Instagram photo.
 */

import { zipStore } from "../common/zip";
import { getToolStates } from "../common/storage";
import {
	IG_CDN_HOST,
	IG_DOWNLOAD,
	IG_DOWNLOAD_ALL,
	IG_ORIGIN,
	INSTAGRAM_FULL_SIZE_ID,
} from "../tools/instagram-full-size/constants";

/** A carousel holds twenty; anything far past that was not sent by the tool. */
const MAX_FILES = 40;

interface ImageFile {
	url: string;
	filename: string;
}

export function listenForInstagramDownloads(): void {
	chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
		if (!raw || typeof raw !== "object") return;
		const message = raw as { type?: unknown };
		if (message.type !== IG_DOWNLOAD && message.type !== IG_DOWNLOAD_ALL) return;
		// The frame Chrome saw the message leave — not what the message says.
		if (!sender.url?.startsWith(`${IG_ORIGIN}/`)) return;

		void handle(raw).then(respond, () => respond({ ok: false }));
		return true; // the answer is async
	});
}

async function handle(raw: object): Promise<{ ok: boolean; zipped?: boolean }> {
	if (!(await getToolStates())[INSTAGRAM_FULL_SIZE_ID]?.enabled) return { ok: false };

	const message = raw as { type: string; url?: unknown; filename?: unknown; files?: unknown; zipName?: unknown };

	if (message.type === IG_DOWNLOAD) {
		const file = validFile(message);
		if (!file) return { ok: false };
		await save(file.url, file.filename);
		return { ok: true };
	}

	if (!Array.isArray(message.files) || message.files.length > MAX_FILES) return { ok: false };
	const files = message.files.map(validFile);
	if (files.length === 0 || files.some((file) => file === null)) return { ok: false };
	const valid = files as ImageFile[];

	const zipName = typeof message.zipName === "string" ? safeName(message.zipName, "zip") : null;
	if (!zipName) return { ok: false };

	try {
		await saveZip(valid, zipName);
		return { ok: true, zipped: true };
	} catch {
		// A fetch failed, or the archive did — the photos still come down, one by one.
		for (const file of valid) await save(file.url, file.filename);
		return { ok: true, zipped: false };
	}
}

async function saveZip(files: ImageFile[], zipName: string): Promise<void> {
	const entries = await Promise.all(
		files.map(async (file) => {
			const response = await fetch(file.url, { credentials: "omit" });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return { name: file.filename, data: new Uint8Array(await response.arrayBuffer()) };
		}),
	);

	// A worker has no URL.createObjectURL, so the archive goes out as a data: URL.
	const url = `data:application/zip;base64,${base64(zipStore(entries))}`;
	await save(url, zipName);
}

function save(url: string, filename: string): Promise<number> {
	return chrome.downloads.download({ url, filename, conflictAction: "uniquify" });
}

function validFile(value: unknown): ImageFile | null {
	if (!value || typeof value !== "object") return null;
	const { url, filename } = value as { url?: unknown; filename?: unknown };
	if (typeof url !== "string" || typeof filename !== "string") return null;
	if (!isCdnUrl(url)) return null;

	const name = safeName(filename, "jpg|jpeg|png|webp|heic");
	return name ? { url, filename: name } : null;
}

function isCdnUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && IG_CDN_HOST.test(parsed.hostname);
	} catch {
		return false;
	}
}

/**
 * A bare file name with an expected extension, or nothing. No directories, no
 * dot-files: chrome.downloads resolves names under the Downloads folder, and
 * this keeps them directly in it.
 */
function safeName(name: string, extensions: string): string | null {
	const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_");
	if (cleaned.startsWith(".") || cleaned.length > 200) return null;
	return new RegExp(`\\.(${extensions})$`, "i").test(cleaned) ? cleaned : null;
}

/** btoa wants a binary string; built in chunks so a 20MB archive does not blow the stack. */
function base64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
