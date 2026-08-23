/**
 * The two values that cross a bundle boundary.
 *
 * The tool id is needed by definition.ts — which the registry pulls in, and so
 * every content script does too — and by src/popup/panels.ts. Everything else
 * this tool knows (the endpoint, the key, the leagues, the cache) belongs to
 * api.ts, and keeping it there is what stops the Pinterest content script from
 * shipping a copy of the lolesports client to every pinterest.com page.
 */

export const T1_TRACKER_ID = "t1-tracker";

/**
 * The setting that permits the one request outside lolesports.com.
 *
 * Named here for the same reason as the id: definition.ts declares the setting
 * and panel.ts reads it, and neither should have to import the other.
 */
export const LEAGUEPEDIA_SETTING = "leaguepedia";
