/**
 * Stand-ins for the two things the flow test must not really use: the providers, and
 * R2. Both are scripted so a test can say "this prediction is still running" or "this
 * upstream is down" and get exactly that.
 */
import type { R2Bucket } from "@cloudflare/workers-types";

export interface StubbedR2 {
  bucket: R2Bucket;
  /** Every key currently held, for asserting that nothing was written. */
  keys(): string[];
}

export function stubR2(): StubbedR2 {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      objects.set(key, {
        bytes: new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      });
      return { key };
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        key,
        size: object.bytes.byteLength,
        httpMetadata: { contentType: object.contentType },
        body: new Blob([object.bytes]).stream(),
      };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };

  return {
    bucket: bucket as unknown as R2Bucket,
    keys: () => [...objects.keys()],
  };
}

export interface PredictionScript {
  /** Statuses handed back by successive polls of this prediction. */
  statuses: Array<"starting" | "processing" | "succeeded" | "failed">;
  error?: string;
}

export interface StubbedProviders {
  /** Install over `globalThis.fetch`. */
  install(): void;
  restore(): void;
  /** What the next `POST /predictions` should behave like, keyed by call order. */
  scriptPrediction(script: PredictionScript): string;
  /** Force the next OpenRouter call to fail with this status. */
  failNextAnalysis(status: number): void;
  calls: { analyses: number; predictions: number; polls: number; downloads: number };
}

const IMAGE_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
export const STUB_OUTPUT_URL = "https://pbxt.replicate.delivery/stub/out.webp";
export const STUB_PROMPT = "A stubbed, ready-to-paste prompt.";
/** $0.0042 — a value that must survive as an exact integer of micro-USD. */
export const STUB_ANALYSIS_COST_USD = 0.0042;

export function stubProviders(): StubbedProviders {
  const original = globalThis.fetch;
  const scripts = new Map<string, PredictionScript>();
  const polled = new Map<string, number>();
  let nextPredictionId = 0;
  let analysisFailure: number | null = null;
  const calls = { analyses: 0, predictions: 0, polls: 0, downloads: 0 };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const stub = async (input: unknown, init?: { method?: string }) => {
    const url = new URL(typeof input === "string" ? input : (input as { url: string }).url);

    if (url.hostname === "openrouter.ai") {
      calls.analyses++;
      if (analysisFailure !== null) {
        const status = analysisFailure;
        analysisFailure = null;
        return json({ error: { message: "stubbed failure" } }, status);
      }
      return json({
        id: "gen-stub-1",
        choices: [{ message: { content: STUB_PROMPT } }],
        usage: {
          prompt_tokens: 700,
          completion_tokens: 120,
          cost: STUB_ANALYSIS_COST_USD,
        },
      });
    }

    if (url.hostname === "api.replicate.com" && init?.method === "POST") {
      calls.predictions++;
      const id = [...scripts.keys()][nextPredictionId++];
      if (!id) throw new Error("no prediction was scripted for this call");
      return json({ id, status: "starting" });
    }

    if (url.hostname === "api.replicate.com") {
      calls.polls++;
      const id = url.pathname.split("/").at(-1) ?? "";
      const script = scripts.get(id);
      if (!script) return json({ detail: "not found" }, 404);
      const index = polled.get(id) ?? 0;
      polled.set(id, index + 1);
      const status = script.statuses[Math.min(index, script.statuses.length - 1)];
      return json({
        id,
        status,
        output: status === "succeeded" ? [STUB_OUTPUT_URL] : null,
        error: status === "failed" ? (script.error ?? "stubbed prediction failure") : null,
      });
    }

    if (url.hostname.endsWith(".replicate.delivery")) {
      calls.downloads++;
      return new Response(IMAGE_BYTES, {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(IMAGE_BYTES.byteLength),
        },
      });
    }

    // Anything else is a real network call leaking out of a test.
    throw new Error(`unexpected fetch to ${url.href}`);
  };

  return {
    install: () => {
      // Cast at the boundary: the stub answers only the four hosts under test, so it
      // deliberately does not implement the whole of `fetch`.
      globalThis.fetch = stub as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
    scriptPrediction: (script) => {
      const id = `pred_stub_${scripts.size + 1}`;
      scripts.set(id, script);
      return id;
    },
    failNextAnalysis: (status) => {
      analysisFailure = status;
    },
    calls,
  };
}
