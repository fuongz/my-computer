import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// There is deliberately NO `resolve.alias` for `#`: the alias is declared once in
// package.json `imports` (which vite, rolldown and `bun run` all resolve through)
// and mirrored in tsconfig `paths` (which is all tsc reads). A third declaration
// here would be a third place to forget when the layout moves.
export default defineConfig({
	// Order matters. A host-platform plugin (e.g. `cloudflare()`) goes FIRST, before
	// tanstackStart(); viteReact() goes last.
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
