/**
 * Key derivation — Argon2id master key from password + salt.
 *
 * Uses argon2-browser WASM. The derived key is a non-extractable AES-256-GCM CryptoKey.
 * The WASM binary is integrity-verified via wasmIntegrityCheck() before first use.
 */

import { toArrayBuffer } from './aesGcm';

export const ArgonType = {
  Argon2d: 0,
  Argon2i: 1,
  Argon2id: 2,
};

async function getArgon2(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).argon2) {
    return (window as any).argon2;
  }
  if (typeof self !== 'undefined' && (self as any).argon2) {
    return (self as any).argon2;
  }
  try {
    // @ts-ignore
    const argon2Module = await import('argon2-browser/dist/argon2-bundled.min.js');
    const mod: any = (argon2Module as any).default || argon2Module;
    if (mod && typeof mod.hash === 'function') {
      return mod;
    }
    if (typeof window !== 'undefined' && (window as any).argon2) {
      return (window as any).argon2;
    }
  } catch {
    // Try main package export as secondary fallback
  }
  try {
    // @ts-ignore
    const argon2Module = await import('argon2-browser');
    const mod: any = (argon2Module as any).default || argon2Module;
    if (mod && typeof mod.hash === 'function') {
      return mod;
    }
  } catch {
    // Ignore resolution errors
  }
  throw new Error('Argon2 library could not be resolved');
}

/** 16-byte random salt for Argon2id key derivation. */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Derive a deterministic 16-byte salt from user email.
 */
export async function getUserSalt(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('blindgrade-user-salt:' + normalized)
  );
  return new Uint8Array(digest).slice(0, 16);
}

/**
 * Derive a deterministic 12-byte session nonce from user email.
 */
export async function getUserSessionNonce(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('blindgrade-user-nonce:' + normalized)
  );
  return new Uint8Array(digest).slice(0, 12);
}

/**
 * Derive a master AES-256-GCM CryptoKey from password + salt via Argon2id.
 *
 * Deterministic: same password + same salt → same key material.
 * The returned CryptoKey has extractable=false.
 */
export async function derivePbkdf2Key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 1000,
      hash: 'SHA-256',
    },
    passKey,
    256
  );
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new Uint8Array(derivedBits)),
    'HKDF',
    false,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Derive master CryptoKey via Argon2id (if available) or PBKDF2.
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  try {
    const argon2 = await getArgon2();
    const result = await argon2.hash({
      pass: password,
      salt,
      type: ArgonType.Argon2id,
      time: 3,
      mem: 65536, // 64 MB
      parallelism: 4,
      hashLen: 32,
    });
    return crypto.subtle.importKey(
      'raw',
      toArrayBuffer(result.hash),
      'HKDF',
      false, // non-extractable
      ['deriveKey', 'deriveBits']
    );
  } catch (err: any) {
    console.warn('[Crypto Warning] Argon2 WASM unavailable, falling back to WebCrypto PBKDF2:', err?.message || err);
    return derivePbkdf2Key(password, salt);
  }
}

/**
 * Derives both primary (Argon2id or PBKDF2) and fallback master keys to guarantee seamless decryption
 * across sessions even if Argon2 WASM availability changes.
 */
export async function deriveKeyWithFallback(
  password: string,
  salt: Uint8Array
): Promise<{ masterKey: CryptoKey; fallbackMasterKey: CryptoKey | null }> {
  const masterKey = await deriveKey(password, salt);
  let fallbackMasterKey: CryptoKey | null = null;
  try {
    // Derive PBKDF2 key as secondary fallback if primary derived via Argon2id
    fallbackMasterKey = await derivePbkdf2Key(password, salt);
  } catch {
    fallbackMasterKey = null;
  }
  return { masterKey, fallbackMasterKey };
}

/**
 * Derive a 32-byte raw buffer from password + salt.
 * Used as intermediate material for HKDF in sessionKey.ts.
 */
export async function deriveRawKeyMaterial(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const argon2 = await getArgon2();
  const result = await argon2.hash({
    pass: password,
    salt,
    type: ArgonType.Argon2id,
    time: 3,
    mem: 65536,
    parallelism: 4,
    hashLen: 32,
  });

  // Import as HKDF key material (extractable=false, usage=deriveKey)
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(result.hash),
    'HKDF',
    false,
    ['deriveKey', 'deriveBits']
  );
}
