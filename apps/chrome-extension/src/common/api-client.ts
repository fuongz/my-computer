import type { Connection } from "./connection";

/**
 * The one place this extension talks to a network.
 *
 * Everything it needs — analysing an image, generating one, checking on a generation —
 * is a call to a single base URL with a single bearer key. No provider credentials, no
 * provider hosts, no per-provider request shapes.
 */

/** The failure shape the API returns for every error, `{ error: { code, message } }`. */
export interface ApiFailure {
	status: number;
	code: string;
	message: string;
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(failure: ApiFailure) {
		super(failure.message);
		this.name = "ApiError";
		this.status = failure.status;
		this.code = failure.code;
	}

	/** True when the fix is in the extension's own settings rather than a retry. */
	get needsSettings(): boolean {
		return this.status === 401 || this.status === 403;
	}
}

export interface GenerationView {
	id: string;
	kind: string;
	status: "processing" | "succeeded" | "failed";
	retained: boolean;
	imageUrl: string | null;
	error: { code: string; message: string } | null;
}

/**
 * How long any single call may hang.
 *
 * Without this a stalled connection leaves the dialog spinning with nothing to
 * retry — a request that is never going to answer should say so. Waiting for an
 * image is not covered by it: that call returns immediately and the wait belongs to
 * the poll, which has its own deadline.
 */
const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(
	connection: Connection,
	method: "GET" | "POST",
	path: string,
	body?: unknown,
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${connection.apiBaseUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${connection.apiKey}`,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (cause) {
		const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
		throw new ApiError({
			status: 0,
			code: timedOut ? "timeout" : "unreachable",
			message: timedOut
				? "The API did not answer within 30 seconds."
				: "Could not reach the API. Check the base URL and your connection.",
		});
	}

	if (!response.ok) {
		// Prefer the API's own code and message; fall back only when the body is not
		// the envelope (a proxy error page, say).
		let code = "http_error";
		let message = `The API returned ${response.status}.`;
		try {
			const failure = (await response.json()) as { error?: { code?: string; message?: string } };
			if (failure.error?.code) code = failure.error.code;
			if (failure.error?.message) message = failure.error.message;
		} catch {
			// keep the fallback
		}
		throw new ApiError({ status: response.status, code, message });
	}

	return (await response.json()) as T;
}

export interface Account {
	user: { email: string; name: string };
	providers: Record<string, { mode: string; last4: string | null; available: boolean }>;
	allowance: {
		analyses: { limit: number; used: number; remaining: number };
		images: { limit: number; used: number; remaining: number };
		resetsAt: string;
	};
}

export async function fetchAccount(connection: Connection): Promise<Account> {
	return request<Account>(connection, "GET", "/v1/me");
}

export async function requestAnalysis(
	connection: Connection,
	imageUrl: string,
): Promise<string> {
	const body = await request<{ prompt: string }>(connection, "POST", "/v1/analyses", {
		imageUrl,
		store: connection.sync,
	});
	return body.prompt;
}

export async function requestImage(
	connection: Connection,
	prompt: string,
): Promise<GenerationView> {
	const body = await request<{ generation: GenerationView }>(
		connection,
		"POST",
		"/v1/images",
		{ prompt, store: connection.sync },
	);
	return body.generation;
}

export async function fetchGeneration(
	connection: Connection,
	id: string,
): Promise<GenerationView> {
	const body = await request<{ generation: GenerationView }>(
		connection,
		"GET",
		`/v1/generations/${encodeURIComponent(id)}`,
	);
	return body.generation;
}

/**
 * A URL the content script can actually put in an `<img>`.
 *
 * A retained image lives behind the API's bearer auth, and an `<img>` cannot send a
 * header — so those are fetched here and handed over as a data URL. An unretained one
 * comes back as the provider's own public URL and needs no help.
 */
export async function toDisplayableUrl(
	connection: Connection,
	imageUrl: string,
): Promise<string> {
	if (!imageUrl.startsWith(connection.apiBaseUrl)) return imageUrl;

	const response = await fetch(imageUrl, {
		headers: { Authorization: `Bearer ${connection.apiKey}` },
	});
	if (!response.ok) throw new Error("Could not download the generated image.");
	const bytes = new Uint8Array(await response.arrayBuffer());
	// The declared type goes into a URL the page will load, so only an image type is
	// carried over. The API narrows this too; agreeing with it costs one line.
	const declared = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "";
	const type = declared.startsWith("image/") ? declared : "image/webp";
	return `data:${type};base64,${base64(bytes)}`;
}

/** Chunked so a megabyte of image does not become a million-argument spread. */
function base64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}
	return btoa(binary);
}
