import { ALLOWANCE_LIMIT_MAX } from "@fuongz/auth";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  currentUserIsAdmin,
  listAccounts,
  setAccountAllowance,
} from "#/server/core/admin";

/** Bounded and integral; `null` means "follow the deployment default". */
const Limit = z.number().int().min(0).max(ALLOWANCE_LIMIT_MAX).nullable();

const AllowanceInput = z.object({
  userId: z.string().min(1),
  analysesLimit: Limit,
  imagesLimit: Limit,
  note: z.string().max(200).nullable(),
  resetToday: z.boolean(),
});

/** Drives whether the nav offers the admin link. The page guards itself regardless. */
export const getIsAdmin = createServerFn({ method: "GET" }).handler(async () =>
  currentUserIsAdmin(),
);

export const getAccounts = createServerFn({ method: "GET" }).handler(async () =>
  listAccounts(),
);

export const saveAccountAllowance = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AllowanceInput.parse(input))
  .handler(async ({ data }) => {
    await setAccountAllowance(data);
    return listAccounts();
  });
