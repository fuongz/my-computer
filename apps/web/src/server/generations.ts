import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  checkGeneration,
  deleteGeneration,
  listGenerations,
  usageReport,
} from "#/server/core/generations";
import { requireUserId } from "#/server/core/session";

export const getGenerations = createServerFn({ method: "GET" }).handler(
  async () => listGenerations(await requireUserId()),
);

export const getUsage = createServerFn({ method: "GET" }).handler(async () =>
  usageReport(await requireUserId()),
);

export const recheckGeneration = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => checkGeneration(await requireUserId(), data.id));

export const removeGeneration = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await deleteGeneration(userId, data.id);
    return listGenerations(userId);
  });
