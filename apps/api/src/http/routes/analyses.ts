import { Hono } from "hono";
import { z } from "zod";
import type { ApiBindings } from "#/http/auth";
import { parseBody } from "#/http/validate";
import { newId } from "#/lib/ids";
import { ProviderError } from "@fuongz/generation";
import { providerApiError } from "#/lib/provider-error";
import { database } from "#/services/db";
import { insertGeneration, viewOf } from "#/services/generations";
import { closeFailedMeteredCall, openMeteredCall } from "#/services/metering";
import {
  ANALYSIS_MODEL,
  analyzeImage,
} from "#/services/providers/openrouter";

const AnalysisRequest = z.object({
  // Bounded and scheme-checked before it is forwarded anywhere. We never fetch it
  // ourselves — OpenRouter does — so this is about rejecting nonsense early rather
  // than about protecting our own egress.
  imageUrl: z
    .url()
    .max(2048)
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "imageUrl must be an http(s) URL",
    ),
  /**
   * Whether to keep this generation. Defaults to FALSE: a service holding other
   * people's images should retain them because it was asked to, not by omission.
   */
  store: z.boolean().default(false),
});

export const analysisRoutes = new Hono<ApiBindings>().post("/", async (c) => {
  const caller = c.get("caller");
  const db = database(c.env);
  const body = await parseBody(c, AnalysisRequest);
  const origin = new URL(c.req.url).origin;

  const { mode, secret } = await openMeteredCall(
    db,
    c.env,
    caller.userId,
    "openrouter",
    "analyses",
  );

  const startedAt = Date.now();
  const base = {
    userId: caller.userId,
    apiKeyId: caller.apiKeyId,
    kind: "analysis" as const,
    mode,
    provider: "openrouter" as const,
    model: ANALYSIS_MODEL,
    retained: body.store,
  };

  try {
    const result = await analyzeImage({ secret, imageUrl: body.imageUrl });
    const row = await insertGeneration(db, {
      ...base,
      id: newId("gen"),
      status: "succeeded",
      // Retention is exactly this: the prompt and what it was made from. The audit
      // half of the row — mode, cost, tokens — is recorded either way.
      prompt: body.store ? result.prompt : null,
      sourceImageUrl: body.store ? body.imageUrl : null,
      providerRequestId: result.providerRequestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicroUsd: result.costMicroUsd,
      costSource: result.costSource,
      latencyMs: Date.now() - startedAt,
      completedAt: new Date(),
    });

    // The prompt is returned whether or not it was retained — producing it is what
    // the caller asked for; keeping it is a separate question.
    return c.json({ generation: viewOf(row, { origin }), prompt: result.prompt });
  } catch (error) {
    await closeFailedMeteredCall(db, caller.userId, "analyses", mode, error);

    if (error instanceof ProviderError) {
      // One translation, so the row's code and the response's code can never disagree
      // about whose fault the failure was.
      const failure = providerApiError(error);
      await insertGeneration(db, {
        ...base,
        id: newId("gen"),
        status: "failed",
        sourceImageUrl: body.store ? body.imageUrl : null,
        errorCode: failure.code,
        errorMessage: error.message.slice(0, 500),
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      });
      throw failure;
    }
    throw error;
  }
});
