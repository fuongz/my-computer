/** Constants shared between this tool's definition, its script, its CSS and the worker. */

export const INSTAGRAM_FULL_SIZE_ID = "instagram-full-size";

/*
 * Message types from the content script to the service worker. The page cannot
 * download a cross-origin image under a name of its choosing, and it cannot
 * read the CDN's bytes to zip them without CORS; the worker can do both.
 */

/** One image: `{ type, url, filename }`. */
export const IG_DOWNLOAD = "fz.ig.download";

/** A whole carousel: `{ type, files: { url, filename }[], zipName }`. */
export const IG_DOWNLOAD_ALL = "fz.ig.download-all";

/*
 * Class names. Every element this tool draws is its own and hangs off <body>,
 * never inside Instagram's React tree, so the prefix is all the scoping the
 * stylesheet needs.
 */
export const IG_BUTTON_CLASS = "fz-ig-button";
export const IG_MENU_CLASS = "fz-ig-menu";
export const IG_LIGHTBOX_CLASS = "fz-ig-lightbox";

/**
 * Where full-size images may be fetched from. The worker checks every URL it is
 * handed against this, so a message can only ever download Instagram's own
 * images, whatever page sent it.
 */
export const IG_CDN_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

/** The only page allowed to ask for a download. */
export const IG_ORIGIN = "https://www.instagram.com";
