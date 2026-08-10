/**
 * Proves a context-menu click only opens consent UI; analysis is a second action —
 * and that the second action now goes to the one configured API URL rather than to a
 * provider.
 */

const local: Record<string, unknown> = {
	"fz.connection.v1": {
		apiBaseUrl: "https://api.test",
		apiKey: "fz_test_key",
		sync: true,
	},
};
const sent: Array<{ tabId: number; message: Record<string, unknown> }> = [];
const menuItems: Array<{ id: string; title: string }> = [];
let installed: (() => void) | undefined;
let menuClicked: ((info: { menuItemId?: string; srcUrl?: string }, tab?: { id?: number }) => void) | undefined;
let messageReceived: ((message: unknown, sender: { tab?: { id?: number } }) => void) | undefined;
const requested: Array<{ url: string; authorization: string | null; body: unknown }> = [];
let imageReady = false;

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

Object.assign(globalThis, {
	chrome: {
		storage: { local: { async get(key: string) { return key in local ? { [key]: local[key] } : {}; }, async set(items: Record<string, unknown>) { Object.assign(local, items); }, async remove(key: string) { delete local[key]; } } },
		contextMenus: {
			removeAll(callback: () => void) { callback(); },
			create(item: { id: string; title: string }) { menuItems.push(item); },
			onClicked: { addListener(listener: typeof menuClicked) { menuClicked = listener; } },
		},
		runtime: {
			onInstalled: { addListener(listener: typeof installed) { installed = listener; } },
			onMessage: { addListener(listener: typeof messageReceived) { messageReceived = listener; } },
			async openOptionsPage() {},
		},
		tabs: { async sendMessage(tabId: number, message: Record<string, unknown>) { sent.push({ tabId, message }); } },
		scripting: { async insertCSS() {}, async executeScript() {} },
	},
	fetch: async (input: string, init?: { headers?: Record<string, string>; body?: string }) => {
		requested.push({
			url: input,
			authorization: init?.headers?.Authorization ?? null,
			body: init?.body ? JSON.parse(init.body) : undefined,
		});
		// The image path: create → poll → download the retained bytes.
		if (input.endsWith("/v1/images")) {
			return json({ generation: { id: "gen_test_1", status: "processing" } });
		}
		if (input.endsWith("/v1/generations/gen_test_1")) {
			return json({
				generation: {
					id: "gen_test_1",
					status: imageReady ? "succeeded" : "processing",
					retained: true,
					imageUrl: imageReady
						? "https://api.test/v1/generations/gen_test_1/image"
						: null,
					error: null,
				},
			});
		}
		if (input.endsWith("/v1/generations/gen_test_1/image")) {
			return new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { "Content-Type": "image/webp" },
			});
		}
		return json({ prompt: "test prompt" });
	},
});

await import("../src/background/index");

installed?.();
assert(menuItems[0]?.title === "How was this made?", "context menu uses the approved label");

menuClicked?.({ menuItemId: "fz-generate-pinterest-prompt", srcUrl: "https://example.test/image.jpg" }, { id: 9 });
await settle();
assert(requested.length === 0, "opening the dialog calls nothing");
assert(sent.length === 1 && sent[0]?.message.type === "fz:prompt-dialog", "menu click opens the confirmation dialog");

messageReceived?.({ type: "fz:analyze-image", imageUrl: "https://example.test/image.jpg" }, { tab: { id: 9 } });
await settle();

assert(requested.length === 1, "Analyze image starts exactly one request");
const call = requested[0];
assert(call?.url === "https://api.test/v1/analyses", "the request goes to the configured API, not a provider");
assert(call?.authorization === "Bearer fz_test_key", "the API key travels as a bearer token");
assert(
	(call?.body as { imageUrl?: string; store?: boolean })?.store === true,
	"the sync switch is passed through as the retention flag",
);
assert(
	!requested.some(({ url }) => url.includes("openrouter.ai") || url.includes("api.replicate.com")),
	"no provider is ever contacted directly",
);
assert(sent.some(({ message }) => message.type === "fz:prompt-loading"), "analysis reports loading");
assert(sent.some(({ message }) => message.type === "fz:prompt-result"), "analysis returns the generated prompt");

/*
 * ── the image contract between the two halves ───────────────────────────────────
 *
 * The service worker no longer waits for an image: it hands back a generation id and
 * the content script's timer drives the polling (an MV3 worker is torn down after ~30s
 * idle and a pending `setTimeout` does not keep it alive). That makes this message
 * contract load-bearing — if the worker stops sending `fz:image-pending`, or stops
 * answering `fz:poll-image`, the dialog spins forever with nothing to retry.
 */
{
	sent.length = 0;
	requested.length = 0;

	messageReceived?.({ type: "fz:generate-image", prompt: "a poster" }, { tab: { id: 9 } });
	await settle();

	const pending = sent.find(({ message }) => message.type === "fz:image-pending");
	assert(pending !== undefined, "starting a generation hands the id back immediately");
	assert(pending?.message.generationId === "gen_test_1", "and it is the id the API returned");
	assert(
		!sent.some(({ message }) => message.type === "fz:image-result"),
		"the worker does not wait for the image itself",
	);

	// A poll while it is still running says nothing — the dialog's own timer decides
	// when to stop asking, so an unfinished generation must not look like a failure.
	sent.length = 0;
	messageReceived?.({ type: "fz:poll-image", generationId: "gen_test_1" }, { tab: { id: 9 } });
	await settle();
	assert(sent.length === 0, "a poll on a running generation reports nothing");

	imageReady = true;
	messageReceived?.({ type: "fz:poll-image", generationId: "gen_test_1" }, { tab: { id: 9 } });
	await settle();

	const result = sent.find(({ message }) => message.type === "fz:image-result");
	assert(result !== undefined, "a poll on a finished generation delivers the image");
	assert(
		String(result?.message.imageUrl).startsWith("data:image/webp;base64,"),
		"a retained image arrives as a data URL, because an <img> cannot send a bearer token",
	);
	assert(
		requested.some(
			({ url, authorization }) =>
				url.endsWith("/image") && authorization === "Bearer fz_test_key",
		),
		"and the bytes were fetched with the API key",
	);
}

// ── with nothing configured, the dialog asks for setup instead of failing ────────
delete local["fz.connection.v1"];
sent.length = 0;
requested.length = 0;
messageReceived?.({ type: "fz:analyze-image", imageUrl: "https://example.test/image.jpg" }, { tab: { id: 9 } });
await settle();

assert(requested.length === 0, "an unconfigured extension makes no request");
const failure = sent.find(({ message }) => message.type === "fz:prompt-error");
assert(failure !== undefined, "it reports the problem to the dialog");
assert(failure?.message.openSettings === true, "and offers to open Settings rather than a retry");

console.log("Prompt confirmation flow checks passed");

async function settle(): Promise<void> {
	for (let pass = 0; pass < 8; pass++) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
