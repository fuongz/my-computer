/**
 * Money, in integer micro-USD. 1_000_000 = $1.
 *
 * Never floats: a ledger that adds up 0.011 three hundred times in binary floating
 * point is a ledger that disagrees with itself.
 */

export function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

/**
 * Replicate reports no cost, so an image has to be priced locally.
 *
 * These are per-image list prices for the model at each quality setting, and they
 * are ESTIMATES — every row priced from this table is stored with
 * `costSource: "estimate"` so a later correction here never silently rewrites
 * history. Verify against the model's page on Replicate before trusting a total.
 */
export const REPLICATE_IMAGE_PRICE_MICRO_USD: Record<
  string,
  Record<string, number>
> = {
  "openai/gpt-image-2": {
    low: 11_000,
    medium: 42_000,
    high: 167_000,
  },
};

/** Null when this model/quality pair is not in the table — an unknown price, not zero. */
export function replicateImagePrice(
  model: string,
  quality: string,
): number | null {
  return REPLICATE_IMAGE_PRICE_MICRO_USD[model]?.[quality] ?? null;
}
