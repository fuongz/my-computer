/**
 * The values that cross a bundle boundary.
 *
 * The tool id is needed by definition.ts — which the registry pulls in, and so
 * every content bundle does too. The message names are shared by the service
 * worker and the injected card, which never import each other. The instruction
 * and the OpenRouter call live in naming.ts, which only the worker imports.
 */

export const TASK_NAMER_ID = "task-namer";

/** Worker → card. */
export const TASK_NAME_LOADING = "fz:task-name-loading";
export const TASK_NAME_RESULT = "fz:task-name-result";
export const TASK_NAME_ERROR = "fz:task-name-error";

/**
 * Card → worker: rewrite this text.
 *
 * One name for both the first ask and Try again, because they are the same
 * request — the worker keeps nothing between them and cannot tell them apart.
 */
export const TASK_NAME_REQUEST = "fz:task-name-request";
export const OPEN_OPTIONS = "fz:open-options";

/**
 * What the worker injects into a tab that has no card listening yet.
 *
 * The content script is declared in the manifest, so this is only for tabs that
 * were already open when the extension was installed or reloaded — Chrome does
 * not retro-inject those.
 */
export const OVERLAY_SCRIPT = "dist/tools/task-namer.js";
export const OVERLAY_STYLES = "dist/tools/task-namer.css";

/**
 * Below this, a selection is a click that dragged rather than a phrase, and a
 * button appearing over it is noise. Three characters is about where "ok" stops
 * and a name starts.
 */
export const MIN_SELECTION_LENGTH = 3;

/**
 * Longer than this and it is a description, not a title to be rewritten. Chrome
 * truncates `info.selectionText` at 1024 characters of its own accord anyway.
 */
export const MAX_SELECTION_LENGTH = 1000;

/**
 * Where the card offers to write the title back over the selection.
 *
 * Only Google Sheets so far, and deliberately a list rather than "everywhere":
 * replacing text means `execCommand` against whatever happens to be focused,
 * and on an arbitrary page that is a good way to overwrite something the user
 * did not mean. A site earns its way onto this list by being one where the
 * whole point is that the title goes into a cell.
 *
 * Evaluated in the service worker, against Chrome's own `pageUrl` — the card
 * is only told the answer. A page cannot talk itself onto the list.
 */
const REPLACEABLE = [/^https:\/\/docs\.google\.com\/spreadsheets\//];

export function supportsReplace(url: string | undefined): boolean {
	if (!url) return false;
	return REPLACEABLE.some((pattern) => pattern.test(url));
}
