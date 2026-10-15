/*
 * Runs at document_idle on www.instagram.com, declared statically in the
 * manifest, and does nothing until the tool's switch says so.
 *
 * Its job is one button over the post photo under the pointer, and the three
 * things that button offers:
 *
 *   - View image: a lightbox with the full-size image, and the rest of the
 *     carousel one arrow key away;
 *   - Download image: the slide being looked at;
 *   - Download all (N): every photo in a carousel, zipped by the worker.
 *
 * Everything this draws hangs off <body>, never inside Instagram's React tree,
 * and finds its photo by asking the browser what is under the pointer rather
 * than by walking Instagram's markup — the class names there are generated and
 * change with every deploy, and photos sit under a transparent layer that takes
 * every pointer event, so the element a mouse event lands on is never the image.
 *
 * Full-size URLs come from the media-info endpoint Instagram's own page uses,
 * asked once per post the first time its menu opens: the `<img>` tags carry
 * 1080px at most, and a carousel only renders the slides next to the one on
 * screen. If that request fails, the image under the pointer still downloads,
 * from the largest size its `srcset` offers.
 */

import {
	getToolStates,
	onToolStatesChanged,
	readMirroredStates,
	writeMirroredStates,
} from "../../common/storage";
import type { ToolStates } from "../../common/types";
import {
	IG_BUTTON_CLASS,
	IG_CDN_HOST,
	IG_DOWNLOAD,
	IG_DOWNLOAD_ALL,
	IG_LIGHTBOX_CLASS,
	IG_MENU_CLASS,
	INSTAGRAM_FULL_SIZE_ID,
} from "./constants";
import {
	assetKey,
	imageFileName,
	largestFromSrcset,
	type MediaItem,
	type Post,
	parseMediaInfo,
	shortcodeToMediaId,
	zipFileName,
} from "./media";

/** Instagram web's public app id; its API answers the web client only with it. */
const IG_APP_ID = "936619743392459";

/** Smaller than this is an avatar or a thumbnail, not a post's photo. */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

/** Inset of the button from the photo's top-right corner, and its size. */
const INSET = 12;
const BUTTON_SIZE = 32;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A tray with an arrow into it, then a small chevron: "download, with options". */
const DOWNLOAD_ICON = "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14";
const CHEVRON_ICON = "M7 10l5 5 5-5";
const CLOSE_ICON = "M6 6l12 12M18 6L6 18";
const PREV_ICON = "M15 5l-7 7 7 7";
const NEXT_ICON = "M9 5l7 7-7 7";

type Media = HTMLImageElement | HTMLVideoElement;

/** What a menu was opened for. `post` is `undefined` while it is being asked for. */
interface MenuContext {
	media: Media;
	shortcode: string;
	carousel: boolean;
	post: Post | null | undefined;
}

let states: ToolStates = readMirroredStates();
let enabled = isEnabled();

/** The photo the button is currently sitting on. */
let target: Media | null = null;
let button: HTMLButtonElement | null = null;
let menu: HTMLDivElement | null = null;
let context: MenuContext | null = null;
let lightbox: HTMLDivElement | null = null;
let restoreOverflow: string | null = null;

/** One request per post per page load, failures excepted so a retry can work. */
const posts = new Map<string, Promise<Post | null>>();

reconcileWithSyncedSettings();
watchForSettingChanges();
watchThePointer();
watchTheKeyboard();

/* --- the switch -------------------------------------------------------- */

function isEnabled(): boolean {
	return states[INSTAGRAM_FULL_SIZE_ID]?.enabled ?? false;
}

function reconcileWithSyncedSettings(): void {
	void getToolStates().then((synced) => {
		states = synced;
		writeMirroredStates(synced);
		setEnabled(isEnabled());
	});
}

function watchForSettingChanges(): void {
	onToolStatesChanged((changed) => {
		states = changed;
		writeMirroredStates(changed);
		setEnabled(isEnabled());
	});
}

/** Off takes everything down at once; nothing is drawn again until a photo is hovered. */
function setEnabled(value: boolean): void {
	enabled = value;
	if (enabled) return;
	closeLightbox();
	closeMenu();
	hideButton();
}

/* --- finding the photo ------------------------------------------------- */

/**
 * The topmost post photo at a point — or a carousel's video slide, which gets
 * the button too, so "Download all" is reachable from any slide. Our own button
 * counts as "still on the same photo": it sits inside the photo's corner.
 */
function mediaAt(x: number, y: number): Media | null | "self" {
	for (const element of document.elementsFromPoint(x, y)) {
		if (button?.contains(element)) return "self";
		if (element instanceof HTMLImageElement) return isPostImage(element) ? element : null;
		if (element instanceof HTMLVideoElement) return isCarouselVideo(element) ? element : null;
	}
	return null;
}

function isPostImage(image: HTMLImageElement): boolean {
	if (!isLargeEnough(image)) return false;
	if (!isCdn(image.currentSrc || image.src)) return false;
	// A photo inside a link to a post is a thumbnail of it: the profile grid, the
	// explore page, "More posts from" under a post. Out of scope; open the post.
	if (image.closest('a[href*="/p/"], a[href*="/reel/"], header')) return false;
	return shortcodeFor(image) !== null;
}

function isCarouselVideo(video: HTMLVideoElement): boolean {
	return isLargeEnough(video) && isInCarousel(video) && shortcodeFor(video) !== null;
}

function isLargeEnough(element: Element): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT;
}

function isCdn(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && IG_CDN_HOST.test(parsed.hostname);
	} catch {
		return false;
	}
}

/**
 * A feed post is an <article>; a post opened over another page is a dialog;
 * a post's own page is <main>. The narrowest of the three that holds the photo.
 */
function postContainer(element: Element): Element | null {
	return element.closest('article, [role="dialog"], main');
}

/**
 * The post's shortcode. Its timestamp is a link to the post itself in every
 * one of the three layouts — the one link inside a post that is reliably about
 * that post, not a tagged account or a comment's. A post's own page, or one
 * open in a dialog, also has it in the address bar.
 */
function shortcodeFor(element: Element): string | null {
	const container = postContainer(element);
	if (!container) return null;

	const timestamp = container.querySelector('a[href*="/p/"] time')?.closest("a");
	const fromTimestamp = shortcodeIn(timestamp?.getAttribute("href") ?? "");
	if (fromTimestamp) return fromTimestamp;

	if (container.matches("article") && !container.closest('[role="dialog"]')) return null;
	return shortcodeIn(window.location.pathname);
}

function shortcodeIn(path: string): string | null {
	return /\/p\/([A-Za-z0-9_-]+)/.exec(path)?.[1] ?? null;
}

/**
 * A carousel is a <ul> of slides — one of the few things in Instagram's markup
 * that is structural rather than a generated class. A single-photo post has
 * no list around its photo.
 */
function isInCarousel(element: Element): boolean {
	const list = element.closest("li")?.parentElement;
	if (list?.tagName !== "UL" || list.children.length < 2) return false;
	return postContainer(list) === postContainer(element);
}

/* --- the pointer ------------------------------------------------------- */

function watchThePointer(): void {
	let queued: PointerEvent | null = null;

	document.addEventListener(
		"pointermove",
		(event) => {
			if (!enabled || event.pointerType === "touch") return;
			if (!queued) requestAnimationFrame(() => {
				if (queued) follow(queued.clientX, queued.clientY);
				queued = null;
			});
			queued = event;
		},
		{ passive: true },
	);

	// Fixed-position, so anything that scrolls — the page, or a dialog's own
	// column — moves the photo out from under the button.
	window.addEventListener("scroll", () => requestAnimationFrame(place), {
		capture: true,
		passive: true,
	});
	window.addEventListener("resize", () => requestAnimationFrame(place), { passive: true });

	document.documentElement.addEventListener("pointerleave", () => {
		if (!menu) hideButton();
	});

	// A press anywhere that is not the menu or its button closes the menu, the
	// way every other menu on the page behaves.
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (!menu) return;
			const node = event.target as Node;
			if (menu.contains(node) || button?.contains(node)) return;
			closeMenu();
		},
		true,
	);
}

function follow(x: number, y: number): void {
	if (menu || lightbox) return; // pinned while a menu is open; nothing under a lightbox
	const found = mediaAt(x, y);
	if (found === "self") return;
	if (!found) {
		hideButton();
		return;
	}
	target = found;
	showButton();
}

/* --- the button -------------------------------------------------------- */

function showButton(): void {
	if (!button) button = createButton();
	if (!button.isConnected) document.body.append(button);
	place();
}

function hideButton(): void {
	button?.remove();
	target = null;
}

/** Keeps the button (and an open menu) in the photo's top-right corner. */
function place(): void {
	if (!button || !target) return;
	if (!target.isConnected) {
		closeMenu();
		hideButton();
		return;
	}

	const rect = target.getBoundingClientRect();
	const top = rect.top + INSET;
	const left = rect.right - INSET - BUTTON_SIZE;
	button.style.top = `${top}px`;
	button.style.left = `${left}px`;

	if (menu) {
		menu.style.top = `${top + BUTTON_SIZE + 6}px`;
		menu.style.right = `${window.innerWidth - (left + BUTTON_SIZE)}px`;
	}
}

function createButton(): HTMLButtonElement {
	const element = document.createElement("button");
	element.type = "button";
	element.className = IG_BUTTON_CLASS;
	element.setAttribute("aria-label", "Full-size image options");
	element.setAttribute("aria-haspopup", "menu");
	element.setAttribute("aria-expanded", "false");
	element.append(icon(DOWNLOAD_ICON, 18), icon(CHEVRON_ICON, 12));

	// Asked early, on the way to a click, so the menu usually opens with its count.
	element.addEventListener("pointerenter", () => {
		const code = target && shortcodeFor(target);
		if (code) void postFor(code);
	});

	element.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (menu) closeMenu();
		else openMenu();
	});

	element.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" && !menu) {
			event.preventDefault();
			openMenu();
		}
	});

	return element;
}

/* --- the menu ---------------------------------------------------------- */

function openMenu(): void {
	if (!target || !button) return;
	const shortcode = shortcodeFor(target);
	if (!shortcode) return;

	context = { media: target, shortcode, carousel: isInCarousel(target), post: undefined };
	menu = document.createElement("div");
	menu.className = IG_MENU_CLASS;
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-label", "Full-size image");
	menu.tabIndex = -1;
	menu.addEventListener("keydown", onMenuKey);
	document.body.append(menu);
	button.setAttribute("aria-expanded", "true");

	renderMenu();
	place();
	focusItem(0);

	const opened = context;
	void postFor(shortcode).then((post) => {
		if (context !== opened) return; // closed, or reopened on another photo
		opened.post = post;
		const focused = items().indexOf(document.activeElement as HTMLButtonElement);
		renderMenu();
		if (focused >= 0) focusItem(focused);
	});
}

function closeMenu(): void {
	if (!menu) return;
	const hadFocus = menu.contains(document.activeElement);
	menu.remove();
	menu = null;
	context = null;
	button?.setAttribute("aria-expanded", "false");
	if (hadFocus) button?.focus();
}

/** Rebuilt whole whenever the post's details arrive; it is three rows. */
function renderMenu(): void {
	if (!menu || !context) return;
	const ctx = context;
	const current = currentSlide(ctx);
	const isVideo = current.item?.kind === "video" || ctx.media instanceof HTMLVideoElement;

	menu.replaceChildren(
		menuItem("View image", isVideo, () => {
			closeMenu();
			view(ctx);
		}),
		menuItem("Download image", isVideo, () => {
			closeMenu();
			void download(ctx);
		}),
	);
	if (isVideo) menu.append(hint("Videos aren't supported"));

	const images = ctx.post?.items.filter((item) => item.kind === "image") ?? [];
	const isCarousel = ctx.post ? ctx.post.items.length > 1 : ctx.carousel;
	if (!isCarousel) return;

	if (ctx.post === undefined) {
		menu.append(menuItem("Download all…", true, () => {}));
	} else if (ctx.post === null) {
		menu.append(menuItem("Download all", true, () => {}), hint("Couldn't load this post"));
	} else {
		const row = menuItem(`Download all (${images.length})`, images.length === 0, () => {
			row.disabled = true;
			row.textContent = `Zipping ${images.length} images…`;
			void downloadAll(ctx).finally(() => {
				if (context === ctx) closeMenu();
			});
		});
		menu.append(row);
	}
}

function menuItem(label: string, disabled: boolean, run: () => void): HTMLButtonElement {
	const item = document.createElement("button");
	item.type = "button";
	item.setAttribute("role", "menuitem");
	item.textContent = label;
	item.disabled = disabled;
	item.addEventListener("click", (event) => {
		event.stopPropagation();
		if (!item.disabled) run();
	});
	return item;
}

function hint(text: string): HTMLDivElement {
	const line = document.createElement("div");
	line.className = `${IG_MENU_CLASS}-hint`;
	line.textContent = text;
	return line;
}

function items(): HTMLButtonElement[] {
	return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
}

function focusItem(index: number): void {
	const list = items();
	if (list.length === 0) {
		menu?.focus();
		return;
	}
	list[(index + list.length) % list.length]?.focus();
}

function onMenuKey(event: KeyboardEvent): void {
	const list = items();
	const at = list.indexOf(document.activeElement as HTMLButtonElement);

	if (event.key === "ArrowDown") focusItem(at + 1);
	else if (event.key === "ArrowUp") focusItem(at - 1);
	else if (event.key === "Home") focusItem(0);
	else if (event.key === "End") focusItem(list.length - 1);
	else if (event.key === "Escape") closeMenu();
	else if (event.key === "Tab") {
		closeMenu();
		return; // let focus move on
	} else return;

	event.preventDefault();
	event.stopPropagation();
}

/* --- what is on screen ------------------------------------------------- */

/**
 * The slide under the button, placed in its post by its CDN file name — every
 * size of an image shares it, so the 1080px `<img>` on screen and the original
 * in the media-info answer match. `slide` is 1-based, for the file name.
 */
function currentSlide(ctx: MenuContext): { item: MediaItem | null; slide: number | null } {
	if (!(ctx.media instanceof HTMLImageElement)) return { item: null, slide: null };

	const key = assetKey(ctx.media.currentSrc || ctx.media.src);
	const index = ctx.post?.items.findIndex((item) => item.key === key) ?? -1;
	if (ctx.post && index >= 0) return { item: ctx.post.items[index] ?? null, slide: index + 1 };

	// Not found, or no answer at all: a single photo is still slide 1.
	return { item: null, slide: ctx.carousel ? null : 1 };
}

/** The best URL there is for the slide on screen: the original, or the page's largest. */
function currentUrl(ctx: MenuContext): string | null {
	const { item } = currentSlide(ctx);
	if (item) return item.url;
	if (!(ctx.media instanceof HTMLImageElement)) return null;
	return largestFromSrcset(ctx.media.srcset, ctx.media.currentSrc || ctx.media.src);
}

/* --- the three actions ------------------------------------------------- */

function view(ctx: MenuContext): void {
	const url = currentUrl(ctx);
	if (!url) return;

	// The whole carousel when the photo on screen was placed in it; otherwise just
	// that photo — opening on slide 1 instead of the one clicked would be wrong.
	const images = ctx.post?.items.filter((item) => item.kind === "image").map((item) => item.url) ?? [];
	const start = images.indexOf(url);
	if (start < 0) openLightbox([url], 0);
	else openLightbox(images, start);
}

async function download(ctx: MenuContext): Promise<void> {
	const url = currentUrl(ctx);
	if (!url) return;
	const { slide } = currentSlide(ctx);
	const username = ctx.post?.username ?? "instagram";
	await send({
		type: IG_DOWNLOAD,
		url,
		filename: imageFileName(username, ctx.shortcode, slide, url),
	});
}

async function downloadAll(ctx: MenuContext): Promise<void> {
	const post = ctx.post;
	if (!post) return;

	const files = post.items.flatMap((item, index) =>
		item.kind === "image"
			? [{ url: item.url, filename: imageFileName(post.username, post.shortcode, index + 1, item.url) }]
			: [],
	);
	if (files.length === 0) return;

	await send({
		type: IG_DOWNLOAD_ALL,
		files,
		zipName: zipFileName(post.username, post.shortcode),
	});
}

/** The worker does the downloading; a worker that is gone has nothing to report back. */
async function send(message: object): Promise<void> {
	try {
		await chrome.runtime.sendMessage(message);
	} catch {
		// The extension was reloaded under this tab; the page needs a reload too.
	}
}

/* --- the post's details ------------------------------------------------ */

function postFor(shortcode: string): Promise<Post | null> {
	let pending = posts.get(shortcode);
	if (!pending) {
		pending = fetchPost(shortcode);
		posts.set(shortcode, pending);
		void pending.then((post) => {
			if (!post) posts.delete(shortcode);
		});
	}
	return pending;
}

/**
 * Same origin as the page, so it goes out with the session the user is already
 * signed in with — the same request Instagram's own page makes for a post, and
 * nothing it could not already see.
 */
async function fetchPost(shortcode: string): Promise<Post | null> {
	const id = shortcodeToMediaId(shortcode);
	if (!id) return null;
	try {
		const response = await fetch(`/api/v1/media/${id}/info/`, {
			credentials: "include",
			headers: { "X-IG-App-ID": IG_APP_ID, "X-Requested-With": "XMLHttpRequest" },
		});
		if (!response.ok) return null;
		return parseMediaInfo(await response.json());
	} catch {
		return null;
	}
}

/* --- the lightbox ------------------------------------------------------ */

function openLightbox(urls: string[], start: number): void {
	closeLightbox();
	hideButton();

	let index = start;
	const root = document.createElement("div");
	root.className = IG_LIGHTBOX_CLASS;
	root.setAttribute("role", "dialog");
	root.setAttribute("aria-modal", "true");
	root.setAttribute("aria-label", "Full-size image");

	const image = document.createElement("img");
	image.className = `${IG_LIGHTBOX_CLASS}-image`;
	image.alt = "";
	image.addEventListener("load", () => root.classList.remove("is-loading"));

	const counter = document.createElement("div");
	counter.className = `${IG_LIGHTBOX_CLASS}-counter`;

	const show = (next: number): void => {
		index = (next + urls.length) % urls.length;
		root.classList.add("is-loading");
		image.src = urls[index] ?? "";
		counter.textContent = `${index + 1} / ${urls.length}`;
	};

	const close = lightboxButton("close", "Close", CLOSE_ICON, closeLightbox);
	root.append(image, close);

	if (urls.length > 1) {
		root.append(
			lightboxButton("prev", "Previous image", PREV_ICON, () => show(index - 1)),
			lightboxButton("next", "Next image", NEXT_ICON, () => show(index + 1)),
			counter,
		);
		root.dataset.carousel = "true";
	}

	// The backdrop closes it; the photo and the controls do not.
	root.addEventListener("click", (event) => {
		if (event.target === root) closeLightbox();
	});
	root.addEventListener("fz-ig-step", (event) => {
		show(index + (event as CustomEvent<number>).detail);
	});

	show(index);
	document.body.append(root);
	lightbox = root;

	restoreOverflow = document.documentElement.style.overflow;
	document.documentElement.style.overflow = "hidden";
	close.focus();
}

function closeLightbox(): void {
	if (!lightbox) return;
	lightbox.remove();
	lightbox = null;
	if (restoreOverflow !== null) document.documentElement.style.overflow = restoreOverflow;
	restoreOverflow = null;
}

function lightboxButton(
	role: string,
	label: string,
	path: string,
	run: () => void,
): HTMLButtonElement {
	const element = document.createElement("button");
	element.type = "button";
	element.className = `${IG_LIGHTBOX_CLASS}-${role}`;
	element.setAttribute("aria-label", label);
	element.append(icon(path, 24));
	element.addEventListener("click", (event) => {
		event.stopPropagation();
		run();
	});
	return element;
}

/**
 * Escape and the arrows, while the lightbox is up. Captured on window, ahead
 * of Instagram's own handlers, and stopped there — otherwise the same arrow key
 * also turns the carousel underneath, and Escape closes the post behind it.
 */
function watchTheKeyboard(): void {
	window.addEventListener(
		"keydown",
		(event) => {
			if (!lightbox) return;
			const step =
				event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;

			if (event.key === "Escape") closeLightbox();
			else if (step && lightbox.dataset.carousel) {
				lightbox.dispatchEvent(new CustomEvent("fz-ig-step", { detail: step }));
			} else if (event.key === "Tab") {
				trapFocus(event, lightbox);
				return;
			} else return;

			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);
}

/** Tab cycles through the lightbox's own buttons while it is modal. */
function trapFocus(event: KeyboardEvent, root: HTMLElement): void {
	const focusable = [...root.querySelectorAll<HTMLButtonElement>("button")];
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (!first || !last) return;

	const leaving = event.shiftKey
		? document.activeElement === first || !root.contains(document.activeElement)
		: document.activeElement === last || !root.contains(document.activeElement);
	if (!leaving) return;

	event.preventDefault();
	event.stopPropagation();
	(event.shiftKey ? last : first).focus();
}

/* --- shared ------------------------------------------------------------ */

function icon(path: string, size: number): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");

	const line = document.createElementNS(SVG_NS, "path");
	line.setAttribute("d", path);
	svg.append(line);
	return svg;
}
