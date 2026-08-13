/**
 * The extension's one credential, and the one server it spends it on.
 *
 * Only the service worker imports this. The key is read there, spent there, and
 * never travels to a content script — an injected bundle runs in a page the
 * extension does not trust, and anything it holds is one `debugger` away from
 * that page's author.
 *
 * `chrome.storage.local`, never `sync`: a synced key is a key on every machine
 * the profile has ever touched, including ones the user has since stopped using.
 */

/** chrome.storage.local key holding the OpenRouter settings. */
export const OPENROUTER_STORAGE_KEY = "fz.openrouter.v1";

/**
 * What a task title is written by unless the Settings page says otherwise.
 *
 * A title is a dozen tokens out of a sentence in, which makes this one of the
 * few calls where the cheapest capable model is simply the right one: $0.08/M
 * in and $0.18/M out, against $0.10/$0.60 for the model this replaced. It also
 * honours `temperature`, which that one silently ignored — so two runs over the
 * same sentence now agree.
 */
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

const BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Long enough for a slow model to answer, short enough that a hung request does
 * not leave a spinner on the page forever. A task title is a handful of tokens.
 */
const TIMEOUT_MS = 30_000;

export interface OpenRouterSettings {
	apiKey: string;
	model: string;
}

export interface OpenRouterStatus {
	configured: boolean;
	model: string;
	/** A non-sensitive tail only, so a saved key can be recognised, not read. */
	keySuffix?: string;
}

/**
 * What went wrong, in words the card can show as-is.
 *
 * `needsSettings` is the difference between "you have not set this up" and "the
 * call failed" — only the first has a button worth offering.
 */
export class OpenRouterError extends Error {
	readonly needsSettings: boolean;

	constructor(message: string, options: { needsSettings?: boolean } = {}) {
		super(message);
		this.name = "OpenRouterError";
		this.needsSettings = options.needsSettings ?? false;
	}
}

export async function getSettings(): Promise<OpenRouterSettings | null> {
	const record = await read();
	if (!record.apiKey) return null;
	return record;
}

export async function getStatus(): Promise<OpenRouterStatus> {
	const record = await read();
	return {
		configured: Boolean(record.apiKey),
		model: record.model,
		...(record.apiKey ? { keySuffix: record.apiKey.slice(-4) } : {}),
	};
}

/**
 * An omitted key keeps the stored one, so changing the model is not a re-paste.
 * The Settings page never repopulates the field, which is the other half of that.
 */
export async function saveSettings(input: {
	apiKey?: string;
	model?: string;
}): Promise<void> {
	const record = await read();
	const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : record.apiKey;
	if (!apiKey) throw new Error("Enter your OpenRouter API key.");

	const model = input.model?.trim() ? input.model.trim() : record.model;
	await write({ apiKey, model });
}

export async function clearSettings(): Promise<void> {
	await chrome.storage.local.remove(OPENROUTER_STORAGE_KEY);
}

/* --- the calls -------------------------------------------------------- */

interface ChatResponse {
	choices?: Array<{
		message?: { content?: string; reasoning?: string };
		finish_reason?: string;
		native_finish_reason?: string;
	}>;
	usage?: {
		completion_tokens?: number;
		completion_tokens_details?: { reasoning_tokens?: number };
	};
}

/**
 * Room for the answer.
 *
 * Far more than a twelve-word title needs, and deliberately so. Half the models
 * worth using now think before they answer, and those tokens come out of this
 * same budget *before* the first character of the title is written — so a
 * ceiling sized for the title alone does not produce a short answer, it
 * produces an empty one with `finish_reason: "length"`. That was a real bug
 * here at 60. At $0.18 per million, headroom is free and the alternative is not.
 */
const MAX_ANSWER_TOKENS = 512;

/**
 * One completion, one string back.
 *
 * `temperature: 0.2` rather than 0: a title is a small rewrite and the model
 * still has to choose a verb, but two runs over the same sentence should not
 * disagree about what it says.
 *
 * `reasoning: { enabled: false }` because there is nothing here to think about
 * — the input is one sentence and the output is one line of it, restated.
 *
 * This is not a precaution. `GET /api/v1/models` reports the default model as
 * `{ default_enabled: true, default_effort: "high", mandatory: false }`: left
 * alone it reasons hard on every call, and reasoning tokens are output tokens
 * charged and counted before the answer starts. That is what returned an empty
 * string here. `mandatory: false` is what makes turning it off legal — for a
 * model that has it mandatory, only the ceiling above saves the call.
 */
export async function complete(options: {
	settings: OpenRouterSettings;
	system: string;
	user: string;
	maxTokens?: number;
}): Promise<string> {
	const body = (await request("/chat/completions", options.settings.apiKey, {
		method: "POST",
		body: JSON.stringify({
			model: options.settings.model,
			temperature: 0.2,
			max_tokens: options.maxTokens ?? MAX_ANSWER_TOKENS,
			reasoning: { enabled: false },
			messages: [
				{ role: "system", content: options.system },
				{ role: "user", content: options.user },
			],
		}),
	})) as ChatResponse;

	const content = body.choices?.[0]?.message?.content?.trim();
	if (content) return content;

	throw emptyAnswer(body, options.settings.model);
}

/**
 * A 200 with no content in it — the call worked, the answer did not.
 *
 * Worth taking apart rather than reporting as one sentence, because the usual
 * cause is specific and the user can act on it: a model that reasons anyway,
 * having spent the whole budget doing so. "Nothing usable" sent people looking
 * at their key, which was never the problem.
 */
function emptyAnswer(body: ChatResponse, model: string): OpenRouterError {
	const choice = body.choices?.[0];
	const finish = choice?.finish_reason ?? choice?.native_finish_reason;
	const thought = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

	if (thought > 0 && finish === "length") {
		return new OpenRouterError(
			`${model} used its whole budget thinking and never wrote the title. Pick a model that does not reason.`,
		);
	}
	if (finish === "length") {
		return new OpenRouterError(`${model} ran out of room before answering.`);
	}
	if (thought > 0) {
		return new OpenRouterError(`${model} returned reasoning but no title.`);
	}
	return new OpenRouterError(`${model} answered with nothing usable.`);
}

export interface KeyInfo {
	label: string;
	/** USD spent on this key so far. */
	usage: number;
	/** USD ceiling, or null for a key with none. */
	limit: number | null;
	freeTier: boolean;
}

/** What **Test connection** asks: is this key real, and what is left on it. */
export async function fetchKeyInfo(apiKey: string): Promise<KeyInfo> {
	const body = (await request("/key", apiKey, { method: "GET" })) as {
		data?: {
			label?: string;
			usage?: number;
			limit?: number | null;
			is_free_tier?: boolean;
		};
	};

	const data = body.data ?? {};
	return {
		label: data.label || "(unlabelled key)",
		usage: typeof data.usage === "number" ? data.usage : 0,
		limit: typeof data.limit === "number" ? data.limit : null,
		freeTier: data.is_free_tier === true,
	};
}

/**
 * The shared half of both calls: auth, the timeout, and one translation from an
 * HTTP failure to a sentence worth showing someone.
 */
async function request(
	path: string,
	apiKey: string,
	init: RequestInit,
): Promise<unknown> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(`${BASE_URL}${path}`, {
			...init,
			signal: abort.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				/*
				 * OpenRouter attributes a call to whatever these name. There is no
				 * site behind this one, so it identifies the extension instead —
				 * enough for the key's owner to recognise the spend on their
				 * activity page.
				 */
				"HTTP-Referer": "https://github.com/fuongz",
				"X-Title": "fuongz's Extensions",
			},
		});
	} catch (cause) {
		clearTimeout(timer);
		if (cause instanceof DOMException && cause.name === "AbortError") {
			throw new OpenRouterError("OpenRouter took too long to answer.");
		}
		throw new OpenRouterError("Could not reach OpenRouter.");
	}
	clearTimeout(timer);

	if (!response.ok) throw await describe(response);
	return response.json();
}

async function describe(response: Response): Promise<OpenRouterError> {
	// A 401 is the only failure the user can fix from the Settings page, so it is
	// the only one that offers it.
	if (response.status === 401 || response.status === 403) {
		return new OpenRouterError(
			"OpenRouter rejected the API key. Check it in Settings.",
			{ needsSettings: true },
		);
	}
	if (response.status === 402) {
		return new OpenRouterError("This OpenRouter key is out of credit.");
	}
	if (response.status === 429) {
		return new OpenRouterError("OpenRouter is rate-limiting this key.");
	}

	const detail = await failureDetail(response);
	return new OpenRouterError(
		detail
			? `OpenRouter failed (${response.status}): ${detail}`
			: `OpenRouter failed (${response.status}).`,
	);
}

/** Their error envelope if it parses, and nothing rather than a guess if not. */
async function failureDetail(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: { message?: string } };
		return body.error?.message?.trim() ?? "";
	} catch {
		return "";
	}
}

async function read(): Promise<OpenRouterSettings> {
	const result = await chrome.storage.local.get(OPENROUTER_STORAGE_KEY);
	const value = result[OPENROUTER_STORAGE_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { apiKey: "", model: DEFAULT_MODEL };
	}

	const source = value as Record<string, unknown>;
	return {
		apiKey: typeof source["apiKey"] === "string" ? source["apiKey"] : "",
		model:
			typeof source["model"] === "string" && source["model"].trim()
				? source["model"]
				: DEFAULT_MODEL,
	};
}

async function write(settings: OpenRouterSettings): Promise<void> {
	await chrome.storage.local.set({ [OPENROUTER_STORAGE_KEY]: settings });
}
