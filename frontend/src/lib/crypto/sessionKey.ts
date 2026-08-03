/**
 * Session key derivation — HKDF from master key + nonce.
 *
 * Derives a per-session AES-256-GCM key from the Argon2id master key.
 * The session key is used for encrypting IDB entries; the master key
 * is only used to re-derive the session key on unlock.
 */

import { writable, derived, get } from 'svelte/store';
import { deriveKey, generateSalt } from '$lib/crypto/keyDerivation';
import { toArrayBuffer } from '$lib/crypto/aesGcm';

/** 12-byte nonce for session key derivation. */
export function generateSessionNonce(): Uint8Array {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Derive a session AES-256-GCM CryptoKey from masterKey + nonce via HKDF-SHA-256.
 *
 * The session key is non-extractable and scoped to encrypt+decrypt only.
 */
export async function deriveSessionKey(
  masterKey: CryptoKey,
  nonce: Uint8Array
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(nonce),
      info: new TextEncoder().encode('blindgrade-session-key-v1'),
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a legacy session AES-256-GCM CryptoKey using old app context ('blindgrade-session-key-v1').
 * Provided for backwards compatibility with pre-rename encrypted session stores.
 */
export async function deriveLegacySessionKey(
  masterKey: CryptoKey,
  nonce: Uint8Array
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(nonce),
      info: new TextEncoder().encode('blindgrade-session-key-v1'),
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive an archive secret (raw bits) from masterKey via HKDF.
 * Used for pseudonym HMAC in .bgproj archives.
 * Purpose string matches ARCHIVE_SECRET_PURPOSE in format.ts.
 */
export async function deriveArchiveSecret(masterKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(16), // Fixed zero-salt for deterministic derivation
      info: new TextEncoder().encode('bgproj-link'),
    },
    masterKey,
    256 // 32 bytes
  );
}
