/** Row ids: a readable prefix plus 128 bits of randomness, sortable by nothing. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}
