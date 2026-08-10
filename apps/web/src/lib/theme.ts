// Theme is a `.dark` class on <html>. Pure and isomorphic — no React, no server
// builtins — so it can be imported from anywhere, including the inline script below.

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

/** Resolve "system" against the OS setting. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );
}

export function getStoredTheme(): Theme {
  const v = globalThis.localStorage?.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function setStoredTheme(theme: Theme) {
  globalThis.localStorage?.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

// Rendered as the FIRST <body> node so the stored theme lands before first paint.
// Nothing else prevents the light-mode flash on a dark-theme load: a React effect
// runs after hydration, which is already too late to be invisible.
//
// It is a module-level constant with no interpolation — that is what makes the
// `dangerouslySetInnerHTML` at the call site safe, and why it must stay that way.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;
