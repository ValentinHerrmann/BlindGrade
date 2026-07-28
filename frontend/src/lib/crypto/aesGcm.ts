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

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext.buffer as ArrayBuffer
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
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );
  return new Uint8Array(plaintextBuffer);
}

/** Encode Uint8Array to base64url string (for JSON serialization). */
export function toBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
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
