import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  type ProviderName,
  PROVIDERS,
  credentialStatuses,
  removeCredential,
  saveCredential,
} from "#/server/core/providers";
import { requireUserId } from "#/server/core/session";

const ProviderInput = z.object({ provider: z.enum(PROVIDERS) });
const SaveInput = ProviderInput.extend({ secret: z.string().min(1).max(500) });

export const getProviderKeys = createServerFn({ method: "GET" }).handler(async () =>
  credentialStatuses(await requireUserId()),
);

export const saveProviderKey = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data }) => {
    await saveCredential(
      await requireUserId(),
      data.provider as ProviderName,
      data.secret,
    );
    // Returns status only. The raw key goes in and never comes back out.
    return credentialStatuses(await requireUserId());
  });

export const removeProviderKey = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ProviderInput.parse(input))
  .handler(async ({ data }) => {
    await removeCredential(await requireUserId(), data.provider as ProviderName);
    return credentialStatuses(await requireUserId());
  });
