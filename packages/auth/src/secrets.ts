/**
 * The at-rest format for a caller's own provider key.
 *
 * Shared because two apps have to agree on it byte for byte: the web app seals a
 * key when the user saves it, and the API opens it to make one upstream call. A
 * second implementation of this would be a second chance to get the IV wrong.
 */

const ALGORITHM = "AES-GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface SealedSecret {
  /** Base64 AES-GCM ciphertext, authentication tag included. */
  ciphertext: string;
  /** Base64 IV. Fresh for every seal — reusing one under the same key breaks GCM. */
  iv: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(masterKeyBase64);
  if (raw.byteLength !== KEY_BYTES) {
    // Fail loudly at the first use rather than silently deriving a weaker key: a
    // short master key is a deployment mistake, not a runtime condition.
    throw new Error(
      `PROVIDER_ENCRYPTION_KEY must be base64 of ${KEY_BYTES} bytes, got ${raw.byteLength}`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as ArrayBuffer,
    ALGORITHM,
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSecret(
  masterKeyBase64: string,
  plaintext: string,
): Promise<SealedSecret> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const sealed = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    encoded as unknown as ArrayBuffer,
  );
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

export async function openSecret(
  masterKeyBase64: string,
  sealed: SealedSecret,
): Promise<string> {
  const key = await importMasterKey(masterKeyBase64);
  const opened = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: fromBase64(sealed.iv) as unknown as ArrayBuffer },
    key,
    fromBase64(sealed.ciphertext) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(opened);
}

/** The only part of a provider key that may ever be shown back to a client. */
export function secretLast4(plaintext: string): string {
  return plaintext.trim().slice(-4);
}
