import { ProviderError, failureDetail } from "@fuongz/generation";
import { usdToMicro } from "#/lib/pricing";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Unchanged from the extension's own request — this slice moves the call, not the behavior. */
export const ANALYSIS_MODEL = "openai/gpt-5.6-luna";

export const ANALYSIS_INSTRUCTION =
  "Analyze this image. Return only one detailed, ready-to-paste prompt for gpt-image-2 that recreates its visual subject, composition, lighting, style, palette, lens/camera perspective, materials, and mood. Do not mention the source image, Pinterest, or add commentary.";

export interface AnalysisResult {
  prompt: string;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  costSource: "provider" | "estimate" | null;
}

interface OpenRouterResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenRouter's own figure in USD, returned because we ask for it below. */
    cost?: number;
  };
}

/**
 * Turn an image into one ready-to-paste image prompt.
 *
 * The image URL is handed to OpenRouter, which fetches it — this Worker never does.
 * That keeps a caller-supplied URL from being a way to make our Worker issue
 * requests to addresses of the caller's choosing.
 */
export async function analyzeImage(options: {
  secret: string;
  imageUrl: string;
}): Promise<AnalysisResult> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        // Ask for the cost of the call in the same response. Reading the provider's
        // own number beats estimating from token counts and a price list we would
        // then have to keep in step with theirs.
        usage: { include: true },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ANALYSIS_INSTRUCTION },
              { type: "image_url", image_url: { url: options.imageUrl } },
            ],
          },
        ],
      }),
    });
  } catch (cause) {
    throw ProviderError.fromNetwork("OpenRouter", cause);
  }

  if (!response.ok) {
    throw ProviderError.fromStatus(
      "OpenRouter",
      response.status,
      await failureDetail(response),
    );
  }

  const body = (await response.json()) as OpenRouterResponse;
  const prompt = body.choices?.[0]?.message?.content?.trim();
  if (!prompt) {
    // A 200 with no usable content: the upstream worked, the answer is unusable.
    // Not the caller's doing, so this refunds.
    throw new ProviderError("OpenRouter returned no prompt.", {
      causedByCaller: false,
      status: response.status,
    });
  }

  const cost = body.usage?.cost;
  return {
    prompt,
    providerRequestId: body.id ?? null,
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    costMicroUsd: typeof cost === "number" ? usdToMicro(cost) : null,
    costSource: typeof cost === "number" ? "provider" : null,
  };
}

