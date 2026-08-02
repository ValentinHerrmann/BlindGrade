import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, toBase64url, fromBase64url, uint8ArrayToBase64 } from '../src/lib/crypto/aesGcm';
import { hmacPseudonymId, importHmacKey, hmacSha256Hex, ensure64CharHex } from '../src/lib/crypto/hmac';
import { deriveSessionKey, generateSessionNonce } from '../src/lib/crypto/sessionKey';
import { getUserSalt, getUserSessionNonce } from '../src/lib/crypto/keyDerivation';
import {
  encryptExam,
  decryptExam,
  encryptExercise,
  decryptExercise,
  encryptStudent,
  decryptStudent,
  encryptScore,
  decryptScore,
  encryptSubmission,
  decryptSubmission,
} from '../src/lib/db/dbEncryption';

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

describe('Deterministic Key Derivation', () => {
  it('generates identical salt and nonce for identical email across sessions', async () => {
    const salt1 = await getUserSalt('teacher@example.com');
    const salt2 = await getUserSalt('TEACHER@example.com ');
    const nonce1 = await getUserSessionNonce('teacher@example.com');
    const nonce2 = await getUserSessionNonce('TEACHER@example.com ');

    expect(salt1.length).toBe(16);
    expect(nonce1.length).toBe(12);
    expect(salt1).toEqual(salt2);
    expect(nonce1).toEqual(nonce2);
  });

  it('generates different salt and nonce for different emails', async () => {
    const saltA = await getUserSalt('userA@example.com');
    const saltB = await getUserSalt('userB@example.com');
    const nonceA = await getUserSessionNonce('userA@example.com');
    const nonceB = await getUserSessionNonce('userB@example.com');

    expect(saltA).not.toEqual(saltB);
    expect(nonceA).not.toEqual(nonceB);
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

describe('IndexedDB Record Encryption-at-Rest', () => {
  async function createTestKey(): Promise<CryptoKey> {
    const rawKey = new Uint8Array(32).fill(123);
    return await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  it('encrypts and decrypts ExamRecord payloads correctly', async () => {
    const key = await createTestKey();
    const originalExam = {
      id: 'exam-uuid-1',
      teacherId: 'teacher@school.org',
      title: 'Informatik Schulaufgabe',
      latexPreamble: '\\usepackage{tikz}',
      latexTemplate: '\\begin{document}Test\\end{document}',
      retentionUntil: '2026-12-31',
      compilationStatus: 'compiled' as const,
      createdAt: '2026-07-26T10:00:00Z',
    };

    const encrypted = await encryptExam(originalExam, key);
    expect(encrypted.payloadCt).toBeDefined();
    expect(encrypted.payloadIv).toBeDefined();

    // Decrypt with key
    const decrypted = await decryptExam(encrypted, key);
    expect(decrypted.title).toBe('Informatik Schulaufgabe');
    expect(decrypted.latexPreamble).toBe('\\usepackage{tikz}');
    expect(decrypted.latexTemplate).toBe('\\begin{document}Test\\end{document}');

    // Decrypt without key (locked state) returns unencrypted properties undefined
    const lockedDecrypted = await decryptExam(encrypted, null);
    expect(lockedDecrypted.title).toBeUndefined();
    expect(lockedDecrypted.latexPreamble).toBeUndefined();
  });

  it('encrypts and decrypts ExerciseRecord payloads correctly', async () => {
    const key = await createTestKey();
    const originalEx = {
      id: 'ex-uuid-1',
      name: 'Algorithm Analysis',
      latexBody: '\\begin{Aufgabe}{Sortieren}\\end{Aufgabe}',
      maxPoints: 10,
      questionType: 'free_text' as const,
      penalty: 0,
    };

    const encrypted = await encryptExercise(originalEx, key);
    expect(encrypted.payloadCt).toBeDefined();

    const decrypted = await decryptExercise(encrypted, key);
    expect(decrypted.name).toBe('Algorithm Analysis');
    expect(decrypted.latexBody).toBe('\\begin{Aufgabe}{Sortieren}\\end{Aufgabe}');

    const locked = await decryptExercise(encrypted, null);
    expect(locked.name).toBeUndefined();
    expect(locked.latexBody).toBeUndefined();
  });
});

describe('Large Binary & Pseudonym Validation Helpers', () => {
  it('converts large Uint8Array (1MB) to Base64 without call stack exceeded error', () => {
    const largeBuffer = new Uint8Array(1024 * 1024); // 1MB
    for (let i = 0; i < largeBuffer.length; i++) {
      largeBuffer[i] = i % 256;
    }
    const b64 = uint8ArrayToBase64(largeBuffer);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(1000000);
  });

  it('guarantees 64-character hex strings for pseudonym_hmac', async () => {
    const rawUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'; // 36 chars
    const hmacHex = await ensure64CharHex(rawUuid);
    expect(hmacHex).toHaveLength(64);

    const existing64Hex = 'a'.repeat(64);
    const result64 = await ensure64CharHex(existing64Hex);
    expect(result64).toBe(existing64Hex);
  });
});
