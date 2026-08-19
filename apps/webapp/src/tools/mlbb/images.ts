/**
 * Artwork is served by this app, out of `public/mlbb/`, not hotlinked from Fandom.
 *
 * `scripts/download-art.ts` writes one file per catalogue row named after that row's
 * id, which is why there is no lookup table here and no image field in the dataset:
 * the id IS the filename. Everything is WebP at 320px, the widest a tile is drawn on
 * a 2× screen.
 *
 * The cost is ~17 MB in the repo. What it buys is a page that does not depend on a
 * third party staying up, does not leak a visit to Fandom for every tile, and works
 * offline in dev.
 */

/** @param id `Hero.id` or `Skin.id`. */
export function artwork(id: string): string {
	return `/mlbb/${id}.webp`;
}
