import { ProviderError, failureDetail } from "./provider-error";

/** Unchanged from the extension's own request — this slice moves the call, not the behavior. */
export const IMAGE_MODEL = "openai/gpt-image-2";

export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
  metrics?: { predict_time?: number };
}

/** Terminal means the prediction will not change again. */
export function isTerminal(status: Prediction["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function outputUrl(prediction: Prediction): string | null {
  const output = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  return typeof output === "string" && output.length > 0 ? output : null;
}

/**
 * Start a prediction and return immediately.
 *
 * Deliberately no `Prefer: wait` header: the row is written as `processing` and the
 * client polls. Holding an HTTP request open for the length of an image generation
 * makes the outcome depend on the caller's tab still being there, which is exactly
 * what the poll exists to avoid.
 */
export async function createPrediction(options: {
  secret: string;
  prompt: string;
  quality: ImageQuality;
}): Promise<Prediction> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.replicate.com/v1/models/${IMAGE_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            prompt: options.prompt,
            quality: options.quality,
            number_of_images: 1,
            output_format: "webp",
          },
        }),
      },
    );
  } catch (cause) {
    throw ProviderError.fromNetwork("Replicate", cause);
  }

  if (!response.ok) {
    throw ProviderError.fromStatus(
      "Replicate",
      response.status,
      await failureDetail(response),
    );
  }
  return (await response.json()) as Prediction;
}

/** Ask where a prediction got to. Called by the poll, never on a timer of our own. */
export async function getPrediction(options: {
  secret: string;
  id: string;
}): Promise<Prediction> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(options.id)}`,
      { headers: { Authorization: `Bearer ${options.secret}` } },
    );
  } catch (cause) {
    throw ProviderError.fromNetwork("Replicate", cause);
  }

  if (!response.ok) {
    throw ProviderError.fromStatus(
      "Replicate",
      response.status,
      await failureDetail(response),
    );
  }
  return (await response.json()) as Prediction;
}
