/** Constants shared between this tool's definition, its script, and its CSS. */

export const YOUTUBE_CINEMA_ID = "youtube-cinema";

/**
 * Attribute the content script keeps on <html>; cinema.css is scoped to it, so
 * the stylesheet is inert on every page that does not have it.
 *
 * Prefixed, unlike the Pinterest theme's: this one lands on a page whose own
 * scripts write plenty of `data-` attributes of their own.
 */
export const CINEMA_ATTRIBUTE = "data-fz-youtube-cinema";

/**
 * Class on the one thing the script draws: the way out, top left, over the
 * video — the one control cinema takes away that the page used to provide.
 * cinema.css styles it, so the two have to agree on the name.
 */
export const CINEMA_BACK_CLASS = "fz-cinema-back";

/**
 * Class on the livestream viewer count, top right — the other thing cinema
 * takes away by hiding `ytd-watch-metadata`. Same deal as the back button:
 * cinema.css positions and styles it, content.ts only ever toggles its
 * presence and its text.
 */
export const CINEMA_VIEWERS_CLASS = "fz-cinema-viewers";

/** Class on the number itself, inside `.fz-cinema-viewers`. */
export const CINEMA_VIEWERS_COUNT_CLASS = "fz-cinema-viewers-count";

/**
 * Class on the video's title, top left beside the way home — the third thing
 * hiding `ytd-watch-metadata` takes away. Same split again: cinema.css lays it
 * out, content.ts only ever toggles its presence and its text.
 */
export const CINEMA_TITLE_CLASS = "fz-cinema-title";

/** Where that button goes. */
export const YOUTUBE_HOME = "https://www.youtube.com/";

/*
 * Two settings rather than one either/or, because they are not alternatives:
 * one says what a watch page does on its own, the other says whether the
 * keyboard can change it. Turning both off leaves the button in the player,
 * which is always there — that is the floor the other two build on.
 */

/** Setting key: does a watch page open with the window already filled. */
export const AUTO_SETTING = "auto-cinema";

/** Setting key: do Shift+F and Escape do anything. */
export const HOTKEY_SETTING = "hotkey";

/** Both settings' values. */
export const SETTING_ON = "on";
export const SETTING_OFF = "off";
