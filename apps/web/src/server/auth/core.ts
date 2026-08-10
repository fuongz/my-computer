import { apiKeyPlugin, authBase } from "@fuongz/auth";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export async function getAuth() {
  const { env } = await import(/* @vite-ignore */ "cloudflare:workers");
  const authEnv = env as typeof env & Record<"BETTER_AUTH_URL" | "BETTER_AUTH_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET", string>;
  return betterAuth({
    // Shared with the API app: base URL, secret, trusted origins, and the D1-backed
    // adapter over the one schema in @fuongz/auth. Everything added below is true of
    // this app only — the API signs nobody in and sets no cookies.
    ...authBase(authEnv),
    socialProviders: {
      github: {
        clientId: authEnv.GITHUB_CLIENT_ID,
        clientSecret: authEnv.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [apiKeyPlugin(), tanstackStartCookies()],
  });
}
