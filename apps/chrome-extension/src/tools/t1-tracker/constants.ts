/**
 * The one value that crosses a bundle boundary.
 *
 * The tool id is needed by definition.ts — which the registry pulls in, and so
 * every content script does too — and by src/popup/panels.ts. Everything else
 * this tool knows (the endpoint, the key, the leagues, the cache) belongs to
 * api.ts, and keeping it there is what stops the Pinterest content script from
 * shipping a copy of the lolesports client to every pinterest.com page.
 */

export const T1_TRACKER_ID = "t1-tracker";
