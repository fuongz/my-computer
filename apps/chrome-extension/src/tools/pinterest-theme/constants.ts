/** Constants shared between this tool's definition and its content script. */

export const PINTEREST_THEME_ID = "pinterest-theme";

/**
 * Attribute the content script keeps on <html>; the stylesheet is scoped to it.
 *
 * Kept at its pre-rebrand name on purpose: it is written into ~350 selectors in
 * pinterest-dark.css and asserted by scripts/preview-theme.ts, and nothing
 * outside this tool can see it.
 */
export const THEME_ATTRIBUTE = "data-pinterest-dark";

/** Background color the theme paints, mirrored into <meta name="theme-color">. */
export const THEME_COLOR = "#11131a";
