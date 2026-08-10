import { betterAuth } from "better-auth";
import { type AuthEnv, apiKeyPlugin, authBase } from "./config";

/**
 * Better Auth for a headless API: API keys and nothing else.
 *
 * No social providers and no cookie handling — the API never signs anybody in, it
 * only answers "does this bearer token belong to a live key, and to whom?". Sharing
 * the schema and the key plugin with the web app is what makes that answer agree
 * with the app that minted the key.
 */
export function createApiAuth(env: AuthEnv) {
  return betterAuth({
    ...authBase(env),
    plugins: [apiKeyPlugin()],
  });
}

export type ApiAuth = ReturnType<typeof createApiAuth>;
