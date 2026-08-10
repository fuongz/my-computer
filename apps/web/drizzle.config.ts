import { defineConfig } from "drizzle-kit";

// A path, not a package specifier: drizzle-kit loads the file itself rather than
// resolving through `exports`, and this app stays the single owner of `migrations/`
// even though the tables it generates from are shared with apps/api.
export default defineConfig({
  dialect: "sqlite",
  schema: "../../packages/auth/src/schema/index.ts",
  out: "./migrations",
});
