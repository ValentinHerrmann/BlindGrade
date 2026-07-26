import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, toBase64url, fromBase64url } from '../src/lib/crypto/aesGcm';
import { hmacPseudonymId, importHmacKey, hmacSha256Hex } from '../src/lib/crypto/hmac';
import { deriveSessionKey, generateSessionNonce } from '../src/lib/crypto/sessionKey';

describe('AES-256-GCM Cryptography', () => {
  it('encrypts and decrypts round-trip successfully', async () => {
    const rawKey = new Uint8Array(32).fill(7);
    const key = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const plaintext = new TextEncoder().encode('Hello BlindGrade Privacy!');
    const { ciphertext, iv } = await encrypt(key, plaintext);

    expect(ciphertext.length).toBeGreaterThan(plaintext.length);
    expect(iv.length).toBe(12);

    const decrypted = await decrypt(key, ciphertext, iv);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello BlindGrade Privacy!');
  });

  it('generates a fresh random IV on every encrypt call', async () => {
    const rawKey = new Uint8Array(32).fill(1);
    const key = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const plaintext = new TextEncoder().encode('Identical payload');
    const res1 = await encrypt(key, plaintext);
    const res2 = await encrypt(key, plaintext);

    // IVs must be different
    expect(res1.iv).not.toEqual(res2.iv);
    // Ciphertexts must be different due to different IVs
    expect(res1.ciphertext).not.toEqual(res2.ciphertext);
  });

  it('throws DOMException when decrypting tampered ciphertext', async () => {
    const rawKey = new Uint8Array(32).fill(5);
    const key = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const plaintext = new TextEncoder().encode('Secret Data');
    const { ciphertext, iv } = await encrypt(key, plaintext);

    // Tamper with the last byte (part of GCM tag)
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(decrypt(key, tampered, iv)).rejects.toThrow();
  });

  it('correctly encodes and decodes base64url', () => {
    const original = new Uint8Array([0, 255, 128, 64, 32, 16]);
    const b64 = toBase64url(original);
    const decoded = fromBase64url(b64);
    expect(decoded).toEqual(original);
  });
});

describe('HMAC-SHA-256 Pseudonym Hashing', () => {
  it('produces deterministic output for identical key and message', async () => {
    const keyBytes = new Uint8Array(32).fill(42);
    const id = 'student-uuid-1234-5678';

    const hash1 = await hmacPseudonymId(id, keyBytes);
    const hash2 = await hmacPseudonymId(id, keyBytes);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('produces different outputs for different exam secrets', async () => {
    const keyBytes1 = new Uint8Array(32).fill(1);
    const keyBytes2 = new Uint8Array(32).fill(2);
    const id = 'student-uuid-1234-5678';

    const hash1 = await hmacPseudonymId(id, keyBytes1);
    const hash2 = await hmacPseudonymId(id, keyBytes2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('HKDF Session Key Derivation', () => {
  it('derives session key from master key and nonce', async () => {
    const masterRaw = new Uint8Array(32).fill(99);
    const masterKey = await crypto.subtle.importKey(
      'raw',
      masterRaw,
      'HKDF',
      false,
      ['deriveKey']
    );

    const nonce = generateSessionNonce();
    expect(nonce.length).toBe(12);

    const sessionKey = await deriveSessionKey(masterKey, nonce);
    expect(sessionKey.algorithm.name).toBe('AES-GCM');
  });
});
