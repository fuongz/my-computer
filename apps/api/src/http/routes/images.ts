import { Hono } from "hono";
import { z } from "zod";
import type { ApiBindings } from "#/http/auth";
import { parseBody } from "#/http/validate";
import { IMAGE_MODEL, IMAGE_QUALITIES, createPrediction } from "@fuongz/generation";
import { newId } from "#/lib/ids";
import { replicateImagePrice } from "#/lib/pricing";
import { ProviderError } from "@fuongz/generation";
import { providerApiError } from "#/lib/provider-error";
import { database } from "#/services/db";
import { insertGeneration, viewOf } from "#/services/generations";
import { closeFailedMeteredCall, openMeteredCall } from "#/services/metering";


const ImageRequest = z.object({
  prompt: z.string().trim().min(1).max(8000),
  /** `low` matches what the extension has always sent; the others are opt-in. */
  quality: z.enum(IMAGE_QUALITIES).default("low"),
  store: z.boolean().default(false),
});

export const imageRoutes = new Hono<ApiBindings>().post("/", async (c) => {
  const caller = c.get("caller");
  const db = database(c.env);
  const body = await parseBody(c, ImageRequest);
  const origin = new URL(c.req.url).origin;

  const { mode, secret } = await openMeteredCall(
    db,
    c.env,
    caller.userId,
    "replicate",
    "images",
  );

  const base = {
    userId: caller.userId,
    apiKeyId: caller.apiKeyId,
    kind: "image" as const,
    mode,
    provider: "replicate" as const,
    model: IMAGE_MODEL,
    retained: body.store,
    prompt: body.store ? body.prompt : null,
  };

  try {
    const prediction = await createPrediction({
      secret,
      prompt: body.prompt,
      quality: body.quality,
    });

    const row = await insertGeneration(db, {
      ...base,
      id: newId("gen"),
      // Written as `processing` the moment the prediction exists, so the work is
      // recorded before anything can go wrong with waiting for it.
      status: "processing",
      providerRequestId: prediction.id,
      // Priced up front: an image costs what its quality costs, and the quality is
      // known now. Recorded as an estimate because Replicate reports no figure, and
      // cleared if the prediction turns out not to produce an image.
      costMicroUsd: replicateImagePrice(IMAGE_MODEL, body.quality),
      costSource: replicateImagePrice(IMAGE_MODEL, body.quality) === null
        ? null
        : "estimate",
    });

    // 202: accepted, not finished. Poll `GET /v1/generations/{id}` from here.
    return c.json({ generation: viewOf(row, { origin }) }, 202);
  } catch (error) {
    await closeFailedMeteredCall(db, caller.userId, "images", mode, error);

    if (error instanceof ProviderError) {
      // One translation, so the row's code and the response's code can never disagree
      // about whose fault the failure was.
      const failure = providerApiError(error);
      await insertGeneration(db, {
        ...base,
        id: newId("gen"),
        status: "failed",
        errorCode: failure.code,
        errorMessage: error.message.slice(0, 500),
        completedAt: new Date(),
      });
      throw failure;
    }
    throw error;
  }
});
