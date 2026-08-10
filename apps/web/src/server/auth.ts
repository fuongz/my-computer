import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getAuth } from "#/server/auth/core";

export const getSession = createServerFn({ method: "GET" }).handler(async () =>
  (await getAuth()).api.getSession({ headers: getRequestHeaders() }),
);
