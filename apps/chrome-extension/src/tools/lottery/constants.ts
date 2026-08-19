/**
 * The one value that crosses a bundle boundary.
 *
 * The tool id is needed by definition.ts — which the registry pulls in, and so
 * every content script does too — and by src/popup/tool-ui.ts. Everything else
 * this tool knows (the site, the provinces, the prize table, the cache) belongs
 * to its own modules, so none of it ships to a page this tool never runs on.
 */

export const LOTTERY_ID = "lottery";
