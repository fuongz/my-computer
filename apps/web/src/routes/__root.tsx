import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { MotionConfig } from "motion/react";
import { THEME_INIT_SCRIPT } from "#/lib/theme";
import appCss from "#/styles/app.css?url";

// Security headers, set on the server for every document request. Defined as a
// server fn because that is what extracts the server-only import out of the client
// bundle — a plain top-level import of `@tanstack/react-start/server` would ship.
const applySecurityHeaders = createServerFn().handler(() => {
  setResponseHeader("X-Content-Type-Options", "nosniff");
  setResponseHeader("X-Frame-Options", "DENY");
  setResponseHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  setResponseHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
});

export const Route = createRootRoute({
  beforeLoad: async () => {
    if (import.meta.env.SSR) await applySecurityHeaders();
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "web" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The theme-init script below toggles `.dark` on <html> before hydration, so
    // its className legitimately differs from the SSR output — scope the mismatch
    // suppression to just this element, never to the whole tree.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* First body node: apply the stored theme before the app paints. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: THEME_INIT_SCRIPT is a
            module-level constant in #/lib/theme with no interpolation — there is no
            other way to run a script before first paint, and no user input reaches it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* One wrapper, and every animation in the tree degrades under
            prefers-reduced-motion without a per-component check. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
        <Scripts />
      </body>
    </html>
  );
}
