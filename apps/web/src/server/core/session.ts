import { getRequestHeaders } from "@tanstack/react-start/server";
import { getAuth } from "#/server/auth/core";

/**
 * The signed-in user's id, or a thrown error.
 *
 * Every server function that touches user-owned rows starts here rather than trusting
 * an id from the client. A route guard keeps the page from rendering; this keeps the
 * data from being read, which is the part that matters.
 */
export async function requireUserId(): Promise<string> {
  const session = await (await getAuth()).api.getSession({
    headers: getRequestHeaders(),
  });
  if (!session) throw new Error("You must be signed in to do that.");
  return session.user.id;
}
