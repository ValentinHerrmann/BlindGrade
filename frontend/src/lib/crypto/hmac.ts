/**
 * Client-side HMAC-SHA-256 helpers.
 *
 * Used to compute pseudonym IDs:
 *   pseudonym_hmac = HMAC-SHA256(raw_pseudonym_uuid, per_exam_secret)
 *
 * The server only ever sees the HMAC — never the raw UUID.
 */

/**
 * Import raw key bytes as an HMAC-SHA-256 CryptoKey.
 * @param keyBytes 32-byte raw key material (e.g., from HKDF derivation).
 */
export async function importHmacKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // non-extractable
    ['sign', 'verify']
  );
}

/**
 * Compute HMAC-SHA-256(message, key) → hex string.
 *
 * @param message UTF-8 string to sign (e.g., raw pseudonym UUID).
 * @param key     CryptoKey created by importHmacKey.
 * @returns Lowercase hex string (64 chars).
 */
export async function hmacSha256Hex(message: string, key: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convenience: HMAC pseudonym ID with a raw byte key.
 *
 * @param rawPseudonymId UUID string of the student.
 * @param examSecretBytes 32-byte per-exam secret (from HKDF).
 */
export async function hmacPseudonymId(
  rawPseudonymId: string,
  examSecretBytes: Uint8Array
): Promise<string> {
  const key = await importHmacKey(examSecretBytes);
  return hmacSha256Hex(rawPseudonymId, key);
}
