/**
 * AES-256-GCM encrypt/decrypt helpers.
 *
 * SECURITY INVARIANTS:
 * - Every encrypt() call generates a fresh random 12-byte IV via crypto.getRandomValues.
 * - IVs are NEVER reused or taken from external inputs.
 * - Decrypt requires the IV that was returned by encrypt — stored alongside ciphertext.
 * - A tampered ciphertext will cause decrypt() to throw DOMException (GCM authentication failure).
 */

export interface EncryptResult {
  /** AES-256-GCM ciphertext (includes 16-byte GCM authentication tag appended by Web Crypto). */
  ciphertext: Uint8Array;
  /** Fresh random 12-byte IV used for this encryption. Must be stored with ciphertext. */
  iv: Uint8Array;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Generates a fresh random 12-byte IV on every call.
 */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<EncryptResult> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv); // Fresh random IV — never reuse

  const plaintextBuffer =
    plaintext.byteOffset === 0 && plaintext.byteLength === plaintext.buffer.byteLength
      ? (plaintext.buffer as ArrayBuffer)
      : (plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBuffer
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    iv,
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 *
 * @throws DOMException if the GCM authentication tag fails (tampered or wrong key/IV).
 */
export async function decrypt(
  key: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const ciphertextBuffer =
    ciphertext.byteOffset === 0 && ciphertext.byteLength === ciphertext.buffer.byteLength
      ? (ciphertext.buffer as ArrayBuffer)
      : (ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer);

  const ivBuffer =
    iv.byteOffset === 0 && iv.byteLength === iv.buffer.byteLength
      ? (iv.buffer as ArrayBuffer)
      : (iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    ciphertextBuffer
  );
  return new Uint8Array(plaintextBuffer);
}

/** Safe Uint8Array to Base64 string converter (chunks array to prevent call stack size exceeded). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK_SIZE = 0x8000; // 32KB
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Encode Uint8Array to base64url string (for JSON serialization). */
export function toBase64url(bytes: Uint8Array): string {
  return uint8ArrayToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode base64url string to Uint8Array. */
export function fromBase64url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
}

/**
 * Decodes a Base64 or Base64URL string to a Uint8Array.
 * Supports chunked decoding, whitespace trimming, padding restoration,
 * and Base64URL character replacement (- and _ instead of + and /).
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  if (!b64 || !b64.trim()) return new Uint8Array(0);

  let normalized = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  if (pad < 4) {
    normalized += '='.repeat(pad);
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
