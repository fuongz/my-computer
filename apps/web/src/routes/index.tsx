import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "#/server/auth";

// A route exports exactly one thing: `Route`. The moment it exports a second,
// something imports the route to get it, and a URL declaration lands on the import
// graph of your components. Extract instead — to hooks/ or components/.
export const Route = createFileRoute("/")({
  beforeLoad: async (): Promise<never> => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/login" });
    throw redirect({ to: "/generations" });
  },
});
