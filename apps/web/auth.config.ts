import type { D1Database } from "@cloudflare/workers-types";
import { apiKeyPlugin, authDatabase } from "@fuongz/auth";
import { betterAuth } from "better-auth";

// This config exists solely for Better Auth's schema generator. Runtime auth is
// configured from Cloudflare bindings in src/server/auth/core.ts.
export const auth = betterAuth({
  database: authDatabase({} as D1Database),
  socialProviders: {
    github: { clientId: "schema-generator", clientSecret: "schema-generator" },
  },
  plugins: [apiKeyPlugin()],
});
