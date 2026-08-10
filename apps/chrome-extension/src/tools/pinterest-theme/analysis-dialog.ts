/*
 * "How was this made?" — one dialog, five states
 * ==============================================
 *
 * WHAT CHANGED AND WHY IT MATTERS
 *
 * This flow used to be four dialogs wearing the same name. Every step called
 * `document.getElementById("fz-prompt-overlay")?.remove()` and rebuilt a card
 * from scratch, so clicking **Analyze image** destroyed the picture the user
 * had just chosen — at exactly the moment the interesting thing was supposed
 * to be happening *to* that picture.
 *
 * So: the overlay is built once and never rebuilt. In particular `<img>` is
 * created once and only its frame changes, which is what lets the thumbnail
 * grow into the hero instead of blinking out and a new one fading in. Each
 * step is a transition, not a screen.
 *
 *     confirm ──Analyze──▶ analyzing ──result──▶ prompt
 *                                                  │
 *                                             Generate
 *                                                  ▼
 *                              generated ◀──url── generating
 *
 * HOW THE MOTION WORKS
 *
 *   - The looping part (the scan) is pure CSS on the compositor — see §5 of
 *     analysis-dialog.css. None of it is driven from here.
 *   - The two things CSS cannot do alone are driven here as one-shot FLIPs:
 *     the card's height, and the image frame's geometry. Both measure before
 *     the DOM change and play the delta out afterwards.
 *
 * WHY NO ANIMATION LIBRARY
 *
 * This bundle is injected at document_start into *every* http(s) page, so its
 * size is a tax on the whole web, not on one app. Chrome is the only target,
 * which means CSS `linear()` easing (113+) is available: `SPRING` below is a
 * real spring sampled once into an easing string, handed to CSS as
 * `--fz-spring` and to WAAPI as `easing`. One definition, both engines, no
 * dependency. Swapping in motion.dev later means replacing that one constant.
 */

/** Every state the card can be in. The value is mirrored to `data-state`. */
type State = "confirm" | "analyzing" | "prompt" | "generating" | "generated" | "error";

/** Matches the spring's settle time; both morphs and the entrance use it. */
const MORPH_MS = 620;

/*
 * Underdamped just enough to overshoot once. Higher damping reads as "slow",
 * lower reads as "wobbly" — this lands where a sheet on iOS does.
 */
const SPRING = springEasing(190, 24, 1, MORPH_MS);

/**
 * Phases shown while the model is out. They advance on a timer and stop on the
 * last one rather than looping: a loop would suggest the request restarted.
 */
const PHASES = [
	"Reading composition and subject…",
	"Sampling palette and light…",
	"Naming materials, lens and mood…",
	"Writing the prompt…",
];

interface Ui {
	overlay: HTMLElement;
	card: HTMLElement;
	dragHandle: HTMLElement;
	orb: HTMLButtonElement;
	orbClose: HTMLButtonElement;
	stage: HTMLElement;
	image: HTMLImageElement;
	/** The strip inside the picture: the controls, and the prompt once it lands. */
	hero: HTMLElement;
	host: HTMLElement;
	panel: HTMLElement;
	imageUrl: string;
	prompt: string | null;
	/** The generated tile, so `fz:image-result` can fill the one already shown. */
	resultStage: HTMLElement | null;
	phaseTimer: number | null;
	returnFocusTo: Element | null;
	dragAbort: AbortController;
}

let ui: Ui | null = null;

/* ------------------------------------------------------------------ *
 * Message routing
 *
 * Kept here rather than in content.ts so the theme file stays about the
 * theme. The protocol is unchanged — background/index.ts is untouched.
 * ------------------------------------------------------------------ */

export function listenForAnalysisMessages(): void {
	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (!message || typeof message !== "object") return;
		const event = message as {
			type?: string;
			prompt?: string;
			message?: string;
			imageUrl?: string;
			generationId?: string;
			openSettings?: boolean;
		};

		if (event.type === "fz:prompt-dialog" && event.imageUrl) open(event.imageUrl);
		// Re-asserts a state the Analyze click already entered optimistically.
		if (event.type === "fz:prompt-loading") showAnalyzing();
		if (event.type === "fz:prompt-result" && event.prompt) showPrompt(event.prompt);
		if (event.type === "fz:prompt-error" && event.message) {
			showError(event.message, event.openSettings === true);
		}
		if (event.type === "fz:image-pending" && event.generationId) {
			startImagePoll(event.generationId);
		}
		if (event.type === "fz:image-result" && typeof event.imageUrl === "string") {
			stopImagePoll();
			showGeneratedImage(event.imageUrl);
		}
		if (event.type === "fz:image-error" && event.message) {
			stopImagePoll();
			showImageError(event.message, event.openSettings === true);
		}
	});
}

/* ------------------------------------------------------------------ *
 * The quick trigger
 *
 * A button parked on the image the pointer is over, so the flow can start
 * without the right-click. It is ONE button that moves, not one per image:
 * a feed lazy-loads images forever, so per-image decoration means an observer
 * and a node per pin for the life of the tab.
 *
 * Hit-testing is done with elementsFromPoint rather than by reading
 * event.target, because sites layer their own anchors and overlays on top of
 * a photo — on Pinterest the pointer is never actually over the <img>.
 * ------------------------------------------------------------------ */

/** Below this, an image is furniture — an avatar, a logo, a spacer. */
const MIN_IMAGE_SIDE = 160;
const TRIGGER_SIZE = 34;
const TRIGGER_INSET = 10;

let trigger: HTMLButtonElement | null = null;
let triggerTarget: HTMLImageElement | null = null;

export function mountQuickTrigger(): void {
	onDomReady(() => {
		if (trigger) return;
		trigger = buildTrigger();
		document.body.append(trigger);

		// Capture phase: a site that stops propagation on its own overlays
		// would otherwise make whole feeds invisible to this.
		document.addEventListener("mouseover", onPointerOver, true);
		// Both are capture-phase and passive — they only ever hide.
		window.addEventListener("scroll", hideTrigger, { capture: true, passive: true });
		window.addEventListener("resize", hideTrigger, { passive: true });
	});
}

function buildTrigger(): HTMLButtonElement {
	const node = document.createElement("button");
	node.id = "fz-quick-trigger";
	node.type = "button";
	node.dataset["shown"] = "0";
	node.title = "How was this made?";
	node.setAttribute("aria-label", "How was this made?");
	node.append(analyzeIcon());

	/*
	 * The button floats over the site's own links. Without swallowing
	 * mousedown as well, a click here also opens the pin behind it — the
	 * navigation starts before `click` ever fires.
	 */
	for (const type of ["mousedown", "pointerdown", "mouseup"] as const) {
		node.addEventListener(type, (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
	}

	node.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		const source = triggerTarget;
		hideTrigger();
		const src = source?.currentSrc || source?.src;
		if (src) open(src);
	});

	return node;
}

function onPointerOver(event: MouseEvent): void {
	if (!trigger) return;
	// The dialog owns the screen once it is open; a second affordance behind it
	// is just something else to click by accident.
	if (ui) return hideTrigger();

	const target = event.target;
	if (target instanceof Node && trigger.contains(target)) return;

	const image = imageUnderPointer(event.clientX, event.clientY);
	if (!image) return hideTrigger();
	showTriggerOver(image);
}

function imageUnderPointer(x: number, y: number): HTMLImageElement | null {
	for (const node of document.elementsFromPoint(x, y)) {
		if (trigger?.contains(node)) continue;
		if (node.closest("#fz-prompt-overlay")) return null;
		if (!(node instanceof HTMLImageElement)) continue;

		const rect = node.getBoundingClientRect();
		if (rect.width < MIN_IMAGE_SIDE || rect.height < MIN_IMAGE_SIDE) continue;
		/*
		 * http(s) only. The URL is handed to OpenRouter, which fetches it from
		 * its own servers — a blob: or data: src resolves in this tab and
		 * nowhere else, so offering the button there promises a request that
		 * cannot succeed.
		 */
		if (!/^https?:\/\//i.test(node.currentSrc || node.src)) continue;
		return node;
	}
	return null;
}

function showTriggerOver(image: HTMLImageElement): void {
	if (!trigger) return;
	// Sites that rewrite <body> wholesale would otherwise take it with them.
	if (!trigger.isConnected) document.body.append(trigger);

	const rect = image.getBoundingClientRect();
	triggerTarget = image;
	// Clamped, so a picture scrolled half off the top still shows its button.
	trigger.style.top = `${Math.max(TRIGGER_INSET, rect.top + TRIGGER_INSET)}px`;
	trigger.style.left = `${Math.min(
		window.innerWidth - TRIGGER_SIZE - TRIGGER_INSET,
		rect.right - TRIGGER_SIZE - TRIGGER_INSET,
	)}px`;
	trigger.dataset["shown"] = "1";
}

function hideTrigger(): void {
	if (!trigger) return;
	trigger.dataset["shown"] = "0";
	triggerTarget = null;
}

function onDomReady(fn: () => void): void {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", fn, { once: true });
	} else {
		fn();
	}
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

/**
 * A right-click on a different image is a different subject, so this tears
 * down any open card and plays a fresh entrance rather than swapping the src
 * under a card that is already mid-flow.
 */
function open(imageUrl: string): void {
	destroy();

	const overlay = element("div", "");
	overlay.id = "fz-prompt-overlay";
	overlay.dataset["state"] = "confirm";
	overlay.dataset["hero"] = "full";
	overlay.setAttribute("role", "dialog");
	// The heading is gone from the design, but the dialog still needs a name —
	// a screen reader would otherwise announce an unlabelled dialog.
	overlay.setAttribute("aria-label", "How was this made?");
	/*
	 * Deliberately NOT aria-modal. This is a panel in the corner with no scrim
	 * and no focus trap; claiming modality would tell a screen reader the rest
	 * of the page had gone away when it is still right there and still usable.
	 */
	/*
	 * Focus lands on the dialog itself, not on its primary action. Focusing the
	 * button drew a focus ring around it the moment the dialog appeared — a
	 * bright border on the one thing that is supposed to read as a solid key —
	 * and a screen reader announces the dialog's own name from here instead of
	 * starting mid-way in at "Analyze image, button".
	 */
	overlay.tabIndex = -1;
	overlay.style.setProperty("--fz-spring", SPRING);

	const card = element("div", "fz-card");
	card.dataset["entering"] = "1";
	const dragHandle = element("div", "fz-drag-handle");
	dragHandle.setAttribute("role", "img");
	dragHandle.setAttribute("aria-label", "Drag dialog to move it");
	dragHandle.title = "Drag to move";

	const minimize = element("button", "fz-minimize");
	minimize.setAttribute("type", "button");
	minimize.setAttribute("aria-label", "Minimize dialog");
	// Symmetric about (7,7) — the centre of the 14-unit viewBox. Drawn 1→11 it
	// centres on (6,6), which `place-items: center` then dutifully centres one
	// unit up and to the left of where the eye expects it.
	minimize.append(icon("M3 7h8"));
	minimize.addEventListener("click", minimizeDialog);

	const orb = element("button", "fz-orb");
	orb.type = "button";
	orb.setAttribute("aria-label", "Restore image analysis dialog");
	orb.append(analyzeIcon());
	orb.addEventListener("click", () => {
		if (orb.dataset["dragged"] === "1") {
			delete orb.dataset["dragged"];
			return;
		}
		restoreDialog();
	});
	const orbClose = element("button", "fz-orb-close");
	orbClose.type = "button";
	orbClose.setAttribute("aria-label", "Close image analysis dialog");
	orbClose.append(icon("M3.6 3.6 10.4 10.4 M10.4 3.6 3.6 10.4"));
	orbClose.addEventListener("click", (event) => {
		event.stopPropagation();
		destroy();
	});

	const stage = element("div", "fz-stage fz-stage-source");
	stage.dataset["busy"] = "0";
	const image = document.createElement("img");
	image.className = "fz-stage-img";
	image.alt = "The image being analyzed";
	image.src = imageUrl;
	const status = statusBadge("");
	// Last, so it is over the scan without needing a higher z-index than the
	// blur it sits on.
	const hero = element("div", "fz-hero");
	stage.append(image, scanLayers(), status, hero);

	const host = element("div", "fz-panel-host");
	const panel = element("div", "fz-panel");
	host.append(panel);

	card.append(dragHandle, minimize, stage, host);
	overlay.append(card, orb, orbClose);
	document.body.append(overlay);

	ui = {
		overlay,
		card,
		dragHandle,
		orb,
		orbClose,
		stage,
		image,
		hero,
		host,
		panel,
		imageUrl,
		prompt: null,
		resultStage: null,
		phaseTimer: null,
		returnFocusTo: document.activeElement,
		dragAbort: new AbortController(),
	};

	mountDrag(ui);
	trackNaturalAspect(image, overlay);
	buildConfirm();
	document.addEventListener("keydown", onKeydown, true);

	overlay.focus({ preventScroll: true });
	window.setTimeout(() => delete card.dataset["entering"], MORPH_MS + 60);
}

function destroy(): void {
	stopImagePoll();
	document.removeEventListener("keydown", onKeydown, true);
	window.removeEventListener("resize", clampDialogPosition);
	ui?.dragAbort.abort();
	if (ui && ui.phaseTimer !== null) window.clearInterval(ui.phaseTimer);
	const previous = ui?.returnFocusTo;
	document.getElementById("fz-prompt-overlay")?.remove();
	ui = null;
	if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
}

const DIALOG_INSET = 12;

/**
 * The handle advertises that the panel moves, while the card's empty surface
 * is also draggable. Sites commonly swallow pointer capture inside injected
 * DOM, so movement is observed on window for the duration of the drag.
 */
function mountDrag(current: Ui): void {
	let pointerId: number | null = null;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let dialogStartX = 0;
	let dialogStartY = 0;
	let dialogWidth = 0;
	let dialogHeight = 0;
	let pendingLeft = 0;
	let pendingTop = 0;
	let frame: number | null = null;
	let draggingOrb = false;
	let orbDragged = false;

	const paint = (): void => {
		frame = null;
		// `translate` is composited, unlike changing left/top for every pointer
		// event. Fast drags therefore stay responsive even on busy host pages.
		current.overlay.style.translate = `${pendingLeft - dialogStartX}px ${pendingTop - dialogStartY}px`;
	};

	const onMove = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) return;
		event.preventDefault();
		if (
			draggingOrb &&
			(Math.abs(event.clientX - pointerStartX) > 4 ||
				Math.abs(event.clientY - pointerStartY) > 4)
		) {
			orbDragged = true;
		}
		[pendingLeft, pendingTop] = clampDialogCoordinates(
			dialogStartX + event.clientX - pointerStartX,
			dialogStartY + event.clientY - pointerStartY,
			dialogWidth,
			dialogHeight,
		);
		if (frame === null) frame = window.requestAnimationFrame(paint);
	};

	const stop = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) return;
		if (frame !== null) {
			window.cancelAnimationFrame(frame);
			frame = null;
		}
		current.overlay.style.translate = "";
		setDialogPosition(pendingLeft, pendingTop);
		if (draggingOrb && orbDragged) current.orb.dataset["dragged"] = "1";
		pointerId = null;
		draggingOrb = false;
		orbDragged = false;
		delete current.overlay.dataset["dragging"];
	};

	const start = (event: PointerEvent, fromOrb: boolean): void => {
		if (pointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
		const bounds = current.overlay.getBoundingClientRect();
		pointerId = event.pointerId;
		draggingOrb = fromOrb;
		orbDragged = false;
		pointerStartX = event.clientX;
		pointerStartY = event.clientY;
		// Pin the current visual position once. Every subsequent move is a
		// compositor-only offset from this point until pointerup commits it.
		setDialogPosition(bounds.left, bounds.top, bounds);
		dialogStartX = Number.parseFloat(current.overlay.style.left);
		dialogStartY = Number.parseFloat(current.overlay.style.top);
		dialogWidth = bounds.width;
		dialogHeight = bounds.height;
		pendingLeft = dialogStartX;
		pendingTop = dialogStartY;
		current.overlay.dataset["dragging"] = "1";
	};

	/*
	 * The handle, and only the handle.
	 *
	 * The whole card used to be the drag surface, with a list of selectors it
	 * had to ignore — buttons, links, the prompt's scroll region. That list is
	 * a standing debt: everything ever added to the card has to be remembered
	 * in it, and the controls now live *on the picture*, which was the biggest
	 * part of that surface. One dedicated grip has no exclusions to keep.
	 */
	current.dragHandle.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		start(event, false);
	});
	current.orb.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		start(event, true);
	});
	window.addEventListener("pointermove", onMove, {
		passive: false,
		signal: current.dragAbort.signal,
	});
	window.addEventListener("pointerup", stop, { signal: current.dragAbort.signal });
	window.addEventListener("pointercancel", stop, { signal: current.dragAbort.signal });
	window.addEventListener("resize", clampDialogPosition, { passive: true });
}

function clampDialogPosition(): void {
	if (!ui) return;
	const bounds = ui.overlay.getBoundingClientRect();
	setDialogPosition(bounds.left, bounds.top, bounds);
}

function clampDialogCoordinates(
	left: number,
	top: number,
	width: number,
	height: number,
): [number, number] {
	const maxLeft = Math.max(DIALOG_INSET, window.innerWidth - width - DIALOG_INSET);
	const maxTop = Math.max(DIALOG_INSET, window.innerHeight - height - DIALOG_INSET);
	return [
		Math.min(Math.max(DIALOG_INSET, left), maxLeft),
		Math.min(Math.max(DIALOG_INSET, top), maxTop),
	];
}

function setDialogPosition(left: number, top: number, bounds?: DOMRect): void {
	if (!ui) return;
	const size = bounds ?? ui.overlay.getBoundingClientRect();
	const [clampedLeft, clampedTop] = clampDialogCoordinates(
		left,
		top,
		size.width,
		size.height,
	);
	ui.overlay.style.left = `${clampedLeft}px`;
	ui.overlay.style.top = `${clampedTop}px`;
	ui.overlay.style.right = "auto";
	ui.overlay.dataset["positioned"] = "1";
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape" && ui && ui.overlay.dataset["minimized"] !== "1") {
		event.stopPropagation();
		destroy();
	}
}

function minimizeDialog(): void {
	if (!ui || ui.overlay.dataset["minimized"] === "1") return;
	ui.overlay.dataset["minimized"] = "1";
	clampDialogPosition();
	ui.orb.focus({ preventScroll: true });
}

function restoreDialog(): void {
	if (!ui || ui.overlay.dataset["minimized"] !== "1") return;
	delete ui.overlay.dataset["minimized"];
	// The full card can be larger than the orb. Clamp after it re-enters layout.
	window.requestAnimationFrame(clampDialogPosition);
	ui.overlay.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ *
 * The panels
 * ------------------------------------------------------------------ */

function buildConfirm(): void {
	const analyze = button("Analyze image", "fz-btn fz-btn-block", () => {
		// The privacy boundary: nothing has left the browser until here.
		showAnalyzing();
		void chrome.runtime.sendMessage({
			type: "fz:analyze-image",
			imageUrl: ui?.imageUrl,
		});
	});
	// The same mark the trigger on the picture carries, so the button reads as
	// that trigger's answer rather than as a second, unrelated control.
	analyze.prepend(analyzeIcon());
	setHero(analyze);
}

/**
 * Refills the strip on the picture.
 *
 * The strip itself is never replaced — it is inside the frame the FLIP scales,
 * and an element that is swapped cannot be animated across the swap. Called
 * with nothing it empties, and CSS takes the empty strip off the picture.
 */
function setHero(...nodes: readonly Node[]): void {
	if (!ui) return;
	ui.hero.replaceChildren(...nodes);
}

function showAnalyzing(): void {
	if (!ui || ui.overlay.dataset["state"] === "analyzing") return;

	// The phase text lives on the picture; the panel below just shows that a
	// prompt is on its way.
	const phase = ui.stage.querySelector<HTMLElement>(".fz-stage-status b");
	if (phase) {
		phase.textContent = PHASES[0] ?? "";
		startPhases(phase);
	}

	// The skeleton goes where the prompt itself will be, so the wait is the
	// shape of its own answer rather than a placeholder somewhere else.
	const skeleton = element("div", "fz-skeleton");
	for (const width of ["100%", "96%", "88%", "70%"]) {
		const line = element("i", "");
		line.style.width = width;
		skeleton.append(line);
	}
	transition("analyzing", () => {});
	setHero(skeleton);
}

function showPrompt(prompt: string): void {
	if (!ui) return;
	ui.prompt = prompt;
	stopPhases();

	// Nothing goes below the picture: the prompt describes what is in the frame,
	// so it is read on the frame. The panel stays empty and CSS collapses it.
	transition("prompt", () => {});
	showPromptSheet(prompt, false);
}

/**
 * The prompt, on the picture.
 *
 * Two shapes of the same thing rather than two states of a form: expanded is
 * the sheet, collapsed is the one button that brings it back. Collapsing hides
 * Generate along with it, because a strip that keeps one control from the
 * expanded shape reads as half-collapsed.
 *
 * Rebuilt rather than shown and hidden: the strip is absolutely positioned
 * inside the frame, so neither shape changes the card's height and there is no
 * morph to preserve — and a rebuilt sheet always starts at the top of the text.
 */
function showPromptSheet(prompt: string, collapsed: boolean): void {
	if (!ui) return;
	ui.hero.dataset["prompt"] = collapsed ? "collapsed" : "expanded";

	if (collapsed) {
		const open = button(
			"See prompt",
			"fz-btn fz-btn-block fz-btn-collapse",
			() => showPromptSheet(prompt, false),
		);
		open.append(chevronIcon());
		setHero(open);
		return;
	}

	const text = element("p", "fz-prompt-text", prompt);
	/*
	 * Focusable so the scroll region is reachable by keyboard, but not a
	 * <textarea>: this is output to read and copy, and a form control would
	 * invite editing that goes nowhere.
	 */
	text.tabIndex = 0;
	text.setAttribute("role", "region");
	text.setAttribute("aria-label", "Generated image prompt");

	const collapse = ghostIcon(chevronIcon(), "Hide prompt");
	collapse.classList.add("fz-btn-collapse");
	collapse.addEventListener("click", () => showPromptSheet(prompt, true));

	const sheet = element("div", "fz-hero-sheet");
	sheet.append(promptHead(prompt, collapse), text);

	setHero(sheet, button("Generate image", "fz-btn fz-btn-block", showGenerating));
}

/* --- the prompt's own controls ---------------------------------------- */

/**
 * The eyebrow and the chips that go with it, wherever the prompt is shown.
 *
 * The prompt is the artifact this whole flow exists to produce, so it does not
 * stop being reachable once a generated image arrives on top of it: every state
 * that shows the prompt at all shows it with Copy and with the control that
 * opens it back up.
 */
function promptHead(prompt: string, trailing: HTMLElement): HTMLElement {
	const tools = element("div", "fz-prompt-tools");
	tools.append(copyChip(prompt), trailing);

	const head = element("div", "fz-prompt-head");
	head.append(element("span", "fz-eyebrow", "Prompt"), tools);
	return head;
}

function copyChip(prompt: string): HTMLButtonElement {
	const copy = button("Copy", "fz-btn fz-btn-ghost fz-btn-copy", () => {
		void navigator.clipboard.writeText(prompt).then(() => {
			copy.dataset["copied"] = "1";
			copy.replaceChildren(icon("M2 7.5 6 11.5 13 3"), label("Copied"));
			window.setTimeout(() => {
				delete copy.dataset["copied"];
				copy.replaceChildren(copyIcon(), label("Copy"));
			}, 1800);
		});
	});
	copy.prepend(copyIcon());
	return copy;
}

/** A square glass chip with a glyph and no label; the name is the tooltip. */
function ghostIcon(glyph: SVGSVGElement, name: string): HTMLButtonElement {
	const node = element("button", "fz-btn fz-btn-ghost fz-btn-icon");
	node.type = "button";
	node.title = name;
	node.setAttribute("aria-label", name);
	node.append(glyph);
	return node;
}

/**
 * Per the flow: generating gets its own tile in the same frame and with the
 * same scan as the source image, so the second wait looks like the first one.
 */
/* ------------------------------------------------------------------ *
 * Waiting for an image
 *
 * The timer that waits for a generation lives HERE, in the page, and not in the
 * service worker. An MV3 service worker is torn down after about 30 seconds of
 * inactivity, and a pending `setTimeout` does not count as activity — so a worker
 * sleeping through its own poll loop is how a generation that Replicate finished in
 * 31 seconds left this dialog spinning forever with nothing to retry.
 *
 * A page's timer has no such problem, and every tick sends a message, which is
 * exactly what wakes the worker and keeps it awake while it answers. The worker
 * stays stateless: one message in, one check of one generation, one reply.
 * ------------------------------------------------------------------ */

/** Matches the server's own view of "too long"; see apps/api's poll deadline. */
const IMAGE_POLL_TIMEOUT_MS = 60_000;
const IMAGE_POLL_INTERVAL_MS = 2_000;

let imagePollTimer: number | null = null;

function startImagePoll(generationId: string): void {
	stopImagePoll();
	const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
	imagePollTimer = window.setInterval(() => {
		if (!ui) return stopImagePoll();
		if (Date.now() > deadline) {
			stopImagePoll();
			// Giving up writes nothing server-side: the generation keeps running and
			// shows up in the web app when it lands.
			showImageError(
				"This is taking longer than a minute. The image may still finish — check Generations in the web app in a moment.",
				false,
			);
			return;
		}
		void chrome.runtime.sendMessage({ type: "fz:poll-image", generationId });
	}, IMAGE_POLL_INTERVAL_MS);
}

function stopImagePoll(): void {
	if (imagePollTimer !== null) window.clearInterval(imagePollTimer);
	imagePollTimer = null;
}

function showGenerating(): void {
	if (!ui?.prompt) return;
	void chrome.runtime.sendMessage({ type: "fz:generate-image", prompt: ui.prompt });

	transition("generating", (panel) => {
		const stage = element("div", "fz-stage fz-stage-result");
		stage.dataset["busy"] = "1";
		stage.append(scanLayers(), statusBadge("Painting your image…"));

		panel.append(promptRecap(), stage);
		if (ui) ui.resultStage = stage;
	});
	// The source is a 66px thumbnail from here on and the prompt has moved to
	// the recap, so the strip has nothing left to hold.
	setHero();
}

function showGeneratedImage(imageUrl: string): void {
	const stage = ui?.resultStage;
	if (!ui || !stage) return;

	const image = document.createElement("img");
	image.className = "fz-result-img";
	image.alt = "The generated image";
	image.src = imageUrl;
	// The tile was square while empty; give it the real shape once it is known.
	image.addEventListener("load", () => {
		if (image.naturalWidth && image.naturalHeight) {
			stage.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
		}
	});
	stage.prepend(image);
	stage.dataset["busy"] = "0";

	// No "Done." line: the image arriving IS the completion notice, and a label
	// restating it is the kind of text that only reads as chrome.
	const link = element("a", "fz-btn fz-btn-block");
	link.setAttribute("href", imageUrl);
	link.setAttribute("target", "_blank");
	link.setAttribute("rel", "noreferrer");
	link.append(downloadIcon(), label("Open or download image"));

	// On the result tile, the same way Analyze sat on the source: the control
	// belongs to the picture it acts on.
	const strip = element("div", "fz-hero");
	strip.append(link);
	stage.append(strip);

	transition("generated", (panel) => {
		panel.append(promptRecap(), stage);
	});
}

function showError(message: string, openSettings: boolean): void {
	if (!ui) return;
	stopPhases();
	// An error is prose, not a statement about the picture — it reads in the
	// panel, and the strip that was mid-analysis is cleared out from under it.
	setHero();

	transition("error", (panel) => {
		panel.append(element("p", "fz-error", message));
		if (openSettings) {
			panel.append(
				button("Open Settings", "fz-btn fz-btn-block", () => {
					void chrome.runtime.sendMessage({ type: "fz:open-options" });
				}),
			);
		} else {
			panel.append(
				button("Try again", "fz-btn fz-btn-block", () => {
					showAnalyzing();
					void chrome.runtime.sendMessage({
						type: "fz:analyze-image",
						imageUrl: ui?.imageUrl,
					});
				}),
			);
		}
	});
}

/** Image errors keep the prompt on screen — it is still the useful artifact. */
function showImageError(message: string, openSettings: boolean): void {
	if (!ui) return;
	const prompt = ui.prompt;
	ui.resultStage = null;
	setHero();

	transition("prompt", (panel) => {
		// The same block as the other post-analysis states: still copyable, still
		// openable. A failed generation is exactly when the prompt matters most.
		if (prompt) panel.append(promptRecap());
		panel.append(element("p", "fz-error", message));
		panel.append(
			openSettings
				? button("Open Settings", "fz-btn fz-btn-block", () => {
						void chrome.runtime.sendMessage({ type: "fz:open-options" });
					})
				: button("Try again", "fz-btn fz-btn-block", showGenerating),
		);
	});
}

/**
 * The prompt below the picture, once the picture is no longer the subject.
 *
 * Three faded lines by default — the generated image is what you are looking at
 * — but it opens to the whole thing and it can always be copied. It used to be
 * a dead preview with the full text one state back, which meant "back" was the
 * only way to read the sentence the image was made from.
 */
function promptRecap(): HTMLElement {
	const prompt = ui?.prompt ?? "";
	const block = element("div", "fz-prompt-block");
	block.dataset["prompt"] = "collapsed";

	const text = element("p", "fz-prompt-text", prompt);
	text.dataset["clamped"] = "1";
	/*
	 * Focusable so the scroll region is reachable by keyboard once it is open,
	 * but not a <textarea>: this is output to read and copy, and a form control
	 * would invite editing that goes nowhere.
	 */
	text.tabIndex = 0;
	text.setAttribute("role", "region");
	text.setAttribute("aria-label", "Generated image prompt");

	const toggle = ghostIcon(chevronIcon(), "Show the whole prompt");
	toggle.classList.add("fz-btn-collapse");
	toggle.setAttribute("aria-expanded", "false");
	toggle.addEventListener("click", () => {
		const opening = block.dataset["prompt"] === "collapsed";
		// Through the card's own morph: this block sits above the result tile, so
		// opening it moves everything below and the card has to grow to suit.
		morphCard(() => {
			block.dataset["prompt"] = opening ? "expanded" : "collapsed";
			if (opening) delete text.dataset["clamped"];
			else text.dataset["clamped"] = "1";
			const name = opening ? "Show less" : "Show the whole prompt";
			toggle.title = name;
			toggle.setAttribute("aria-label", name);
			toggle.setAttribute("aria-expanded", String(opening));
		});
	});

	block.append(promptHead(prompt, toggle), text);
	return block;
}

/* ------------------------------------------------------------------ *
 * The morph
 * ------------------------------------------------------------------ */

/**
 * Swaps the panel and plays the size change out.
 *
 * Order matters: measure while the old panel is still in flow, then mutate,
 * then measure again. The outgoing panel is lifted out of flow (not removed)
 * so it can cross-fade under the incoming one while the card resizes.
 */
function transition(state: State, build: (panel: HTMLElement) => void): void {
	const current = ui;
	if (!current) return;

	const cardFirst = current.card.getBoundingClientRect();
	const stageFirst = current.stage.getBoundingClientRect();

	const leaving = current.panel;
	leaving.dataset["leaving"] = "1";
	settle(
		leaving.animate(
			[
				{ opacity: 1, transform: "none" },
				{ opacity: 0, transform: "translateY(-6px)" },
			],
			{ duration: 190, easing: "ease-out", fill: "forwards" },
		),
	).then(() => leaving.remove());

	const panel = element("div", "fz-panel");
	build(panel);
	current.host.append(panel);
	current.panel = panel;

	current.overlay.dataset["state"] = state;
	/*
	 * The source image holds the frame until a *generated* image exists to take
	 * it, then demotes to a thumbnail — same FLIP, reversed.
	 *
	 * confirm is "full" because there is no longer a heading to sit beside a
	 * thumbnail: with the title gone, a lone 66px square at the top of an empty
	 * row was all that layout had left.
	 */
	current.overlay.dataset["hero"] =
		state === "confirm" || state === "analyzing" || state === "prompt"
			? "full"
			: "thumb";
	current.stage.dataset["busy"] = state === "analyzing" ? "1" : "0";

	flip(current.card, cardFirst, current.stage, stageFirst);
	// A longer state can make a dialog that was dragged near the bottom extend
	// past the viewport. Keep its new edge reachable after every layout change.
	clampDialogPosition();

	panel.animate(
		[
			{ opacity: 0, transform: "translateY(8px)" },
			{ opacity: 1, transform: "none" },
		],
		{ duration: 380, delay: 90, easing: SPRING, fill: "backwards" },
	);
}

/**
 * Runs a mutation that changes the card's height and plays the change out.
 *
 * The state machine's own transitions do this around a panel swap; this is the
 * same measure-mutate-measure for a change *inside* a panel, where there is no
 * cross-fade to hang it on.
 */
function morphCard(mutate: () => void): void {
	const current = ui;
	if (!current) return;

	const cardFirst = current.card.getBoundingClientRect();
	const stageFirst = current.stage.getBoundingClientRect();
	mutate();
	/*
	 * Clamped before the animation, not after. Once flip() starts, the card's
	 * measured height is whatever the animation is currently holding — the
	 * *old* one on the first frame — so a clamp taken then reads the dialog as
	 * still fitting and leaves a grown card hanging off the bottom of the
	 * screen. Here the layout is final and nothing is animating yet, so flip()
	 * also measures the position this settled on.
	 */
	clampDialogPosition();
	flip(current.card, cardFirst, current.stage, stageFirst);
}

/**
 * Plays back a layout change that has already happened.
 *
 * The card animates height (the only way to make a resize look continuous),
 * and the image frame animates transform. The frame's scale has to be undone
 * on the `<img>` inside it, or the picture is squashed for the whole 620ms —
 * both ends carry `transform-origin: 0 0` in CSS so this arithmetic holds.
 */
function flip(
	card: HTMLElement,
	cardFirst: DOMRect,
	stage: HTMLElement,
	stageFirst: DOMRect,
): void {
	const cardLast = card.getBoundingClientRect();
	if (Math.abs(cardLast.height - cardFirst.height) > 1) {
		card.dataset["morphing"] = "1";
		settle(
			card.animate(
				[{ height: `${cardFirst.height}px` }, { height: `${cardLast.height}px` }],
				{ duration: MORPH_MS, easing: SPRING },
			),
		).then(() => delete card.dataset["morphing"]);
	}

	const stageLast = stage.getBoundingClientRect();
	if (!stageFirst.width || !stageLast.width) return;

	const dx = stageFirst.left - stageLast.left;
	const dy = stageFirst.top - stageLast.top;
	const sx = stageFirst.width / stageLast.width;
	const sy = stageFirst.height / stageLast.height;
	const moved =
		Math.abs(dx) > 0.5 ||
		Math.abs(dy) > 0.5 ||
		Math.abs(sx - 1) > 0.005 ||
		Math.abs(sy - 1) > 0.005;
	if (!moved) return;

	stage.animate(
		[
			{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
			{ transform: "none" },
		],
		{ duration: MORPH_MS, easing: SPRING },
	);

	stage
		.querySelector<HTMLElement>(".fz-stage-img")
		?.animate(
			[{ transform: `scale(${1 / sx}, ${1 / sy})` }, { transform: "none" }],
			{ duration: MORPH_MS, easing: SPRING },
		);
}

/**
 * The hero frame takes the picture's own proportions, so growing into it never
 * letterboxes or crops. A cached image is already `complete` and will not fire
 * `load`, hence the two paths.
 */
function trackNaturalAspect(image: HTMLImageElement, overlay: HTMLElement): void {
	const apply = (): void => {
		if (!image.naturalWidth || !image.naturalHeight) return;
		overlay.style.setProperty(
			"--fz-aspect",
			`${image.naturalWidth} / ${image.naturalHeight}`,
		);
	};
	if (image.complete) apply();
	image.addEventListener("load", apply, { once: true });
}

function startPhases(node: HTMLElement): void {
	stopPhases();
	let index = 0;
	const timer = window.setInterval(() => {
		index++;
		const next = PHASES[index];
		if (next === undefined) {
			stopPhases();
			return;
		}
		node.textContent = next;
		// Re-trigger the entry animation for the new line.
		node.style.animation = "none";
		void node.offsetWidth;
		node.style.animation = "";
	}, 2400);
	if (ui) ui.phaseTimer = timer;
}

function stopPhases(): void {
	if (!ui || ui.phaseTimer === null) return;
	window.clearInterval(ui.phaseTimer);
	ui.phaseTimer = null;
}

/* ------------------------------------------------------------------ *
 * Small builders
 *
 * Elements rather than markup, matching common/ui.ts — and it keeps every
 * caller-supplied string (the prompt, the image URL, provider error text) on
 * textContent and src, where it cannot become markup.
 * ------------------------------------------------------------------ */

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	content?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (content !== undefined) node.textContent = content;
	return node;
}

function button(
	text: string,
	className: string,
	onClick: () => void,
): HTMLButtonElement {
	const node = element("button", className);
	node.type = "button";
	node.append(label(text));
	node.addEventListener("click", () => {
		if (node.disabled) return;
		onClick();
	});
	return node;
}

function label(text: string): HTMLSpanElement {
	return element("span", "", text);
}


function icon(path: string): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 14 14");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.9");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
	node.setAttribute("d", path);
	svg.append(node);
	return svg;
}

/**
 * The AI-image mark: a lens open at the upper right with a spark sitting in
 * the gap. The arc stops short of a full circle on purpose — a closed ring
 * plus a star reads as two icons that happen to overlap.
 */
function analyzeIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.9");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");

	const lens = document.createElementNS("http://www.w3.org/2000/svg", "path");
	lens.setAttribute("d", "M14.79 5.59A6.6 6.6 0 1 0 16.98 13.79");

	const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
	handle.setAttribute("d", "M16.1 16.1 20.2 20.2");

	const spark = document.createElementNS("http://www.w3.org/2000/svg", "path");
	spark.setAttribute(
		"d",
		"M18.5 2.3 19.4 4.6 21.7 5.5 19.4 6.4 18.5 8.7 17.6 6.4 15.3 5.5 17.6 4.6Z",
	);
	spark.setAttribute("fill", "currentColor");
	spark.setAttribute("stroke", "none");

	svg.append(lens, handle, spark);
	return svg;
}

/** Points down — "put this away". Rotated by CSS in the collapsed strip. */
function chevronIcon(): SVGSVGElement {
	return icon("M2.6 5 7 9.4 11.4 5");
}

function downloadIcon(): SVGSVGElement {
	return icon("M7 1.6v7.6 M4 6.4 7 9.4 10 6.4 M1.9 11.2v0.6a0.6 0.6 0 0 0 0.6 0.6h9a0.6 0.6 0 0 0 0.6-0.6v-0.6");
}

/**
 * Hugeicons `Copy01Icon`, transcribed.
 *
 * The paths are copied verbatim from @hugeicons/core-free-icons rather than
 * imported: that package ships React components, and this bundle is injected
 * into every page — pulling React in to draw one 14px glyph is not a trade
 * worth making. Stroke is 1.8 rather than the pack's 1.5 because at 14px the
 * thinner weight disappears next to the text beside it.
 */
function copyIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.8");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");

	for (const d of [
		"M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9L16 9C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16L9 15Z",
		"M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999",
	]) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

/**
 * The pill that rides on the picture while the model is out. Built for every
 * frame up front, empty and hidden — the stage's `data-busy` reveals it, so
 * showing it never costs a layout pass.
 */
function statusBadge(text: string): HTMLElement {
	const badge = element("div", "fz-stage-status");
	badge.setAttribute("role", "status");
	badge.append(spinnerIcon(), element("b", "", text));
	return badge;
}

function spinnerIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("aria-hidden", "true");

	const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	ring.setAttribute("cx", "8");
	ring.setAttribute("cy", "8");
	ring.setAttribute("r", "6");
	ring.setAttribute("opacity", "0.35");

	// A quarter turn of bright arc over the dim ring is what reads as motion.
	const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
	arc.setAttribute("d", "M14 8a6 6 0 0 0-6-6");

	svg.append(ring, arc);
	return svg;
}

function scanLayers(): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const scan = element("div", "fz-scan");
	scan.setAttribute("aria-hidden", "true");
	scan.append(
		element("div", "fz-scan-grid"),
		element("div", "fz-scan-veil"),
		element("div", "fz-scan-beam"),
	);
	fragment.append(scan);
	return fragment;
}

/** A cancelled animation rejects; every caller here only cares that it ended. */
function settle(animation: Animation): Promise<void> {
	return animation.finished.then(noop, noop);
}

function noop(): void {}

/* ------------------------------------------------------------------ *
 * The spring
 * ------------------------------------------------------------------ */

/**
 * Samples a damped harmonic oscillator into a CSS `linear()` easing.
 *
 * This exists so one spring can drive both engines: CSS reads it as
 * `--fz-spring`, WAAPI takes the same string as `easing`. `linear()` needs
 * Chrome 113+, which a Chrome extension may simply assume.
 *
 * `damping < 2·√(stiffness·mass)` is the underdamped case and the only one
 * worth having — it overshoots once, which is what makes a morph read as
 * physical rather than as a timed fade. The critically-damped branch is kept
 * so a caller cannot accidentally produce NaN by tuning past it.
 */
function springEasing(
	stiffness: number,
	damping: number,
	mass: number,
	duration: number,
	samples = 44,
): string {
	const natural = Math.sqrt(stiffness / mass);
	const ratio = damping / (2 * Math.sqrt(stiffness * mass));
	const damped = ratio < 1 ? natural * Math.sqrt(1 - ratio * ratio) : 0;
	const points: string[] = [];

	for (let step = 0; step <= samples; step++) {
		const t = (step / samples) * (duration / 1000);
		const decay = Math.exp(-ratio * natural * t);
		const value =
			ratio < 1
				? 1 -
					decay *
						(Math.cos(damped * t) + ((ratio * natural) / damped) * Math.sin(damped * t))
				: 1 - Math.exp(-natural * t) * (1 + natural * t);
		points.push(value.toFixed(4));
	}

	// Land exactly on 1: a spring that is merely very close to settled reads as
	// a sub-pixel drift at the end of every morph.
	points[points.length - 1] = "1";
	return `linear(${points.join(",")})`;
}
