import { get } from 'svelte/store';
import { sessionStore } from '$lib/stores/session';

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
 * Safely converts a Uint8Array (or ArrayBufferView) to an ArrayBuffer slice
 * that respects byteOffset and byteLength. Prevents passing entire underlying
 * WASM heap or shared buffers to WebCrypto APIs.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Generates a fresh random 12-byte IV on every call.
 */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<EncryptResult> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv); // Fresh random IV — never reuse

  const plaintextBuffer = toArrayBuffer(plaintext);

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
  key: CryptoKey | null | undefined,
  ciphertext: Uint8Array,
  iv: Uint8Array,
  fallbackKey?: CryptoKey | null
): Promise<Uint8Array> {
  const ciphertextBuffer = toArrayBuffer(ciphertext);
  const ivBuffer = toArrayBuffer(iv);
  const activeFallbackKey =
    fallbackKey ?? (typeof window !== 'undefined' ? get(sessionStore).fallbackSessionKey : null);

  let primaryErr: any = null;
  if (key) {
    try {
      const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        key,
        ciphertextBuffer
      );
      return new Uint8Array(plaintextBuffer);
    } catch (err) {
      primaryErr = err;
    }
  }

  if (activeFallbackKey) {
    try {
      const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        activeFallbackKey,
        ciphertextBuffer
      );
      return new Uint8Array(plaintextBuffer);
    } catch {
      // Fallback also failed, ignore error to throw primary error below
    }
  }

  throw primaryErr || new Error('Decryption failed: no valid key provided');
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
