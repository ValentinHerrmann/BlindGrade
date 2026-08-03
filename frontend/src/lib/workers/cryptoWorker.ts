/**
 * Web Worker for off-main-thread AES-256-GCM encryption & decryption of large blobs.
 *
 * Structured Cloning of CryptoKey objects is supported per W3C Web Crypto spec.
 */

export type CryptoWorkerRequest =
  | { type: 'ENCRYPT'; key: CryptoKey; plaintext: Uint8Array; id: number }
  | { type: 'DECRYPT'; key: CryptoKey; ciphertext: Uint8Array; iv: Uint8Array; id: number };

export type CryptoWorkerResponse =
  | { type: 'ENCRYPTED'; ciphertext: Uint8Array; iv: Uint8Array; id: number }
  | { type: 'DECRYPTED'; plaintext: Uint8Array; id: number }
  | { type: 'ERROR'; message: string; id: number };

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  const req = event.data;
  try {
    if (req.type === 'ENCRYPT') {
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);

      const ctBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(iv) },
        req.key,
        toArrayBuffer(req.plaintext)
      );
      const ciphertext = new Uint8Array(ctBuffer);

      self.postMessage(
        { type: 'ENCRYPTED', ciphertext, iv, id: req.id },
        [ciphertext.buffer]
      );
    } else if (req.type === 'DECRYPT') {
      const ptBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(req.iv) },
        req.key,
        toArrayBuffer(req.ciphertext)
      );
      const plaintext = new Uint8Array(ptBuffer);

      self.postMessage(
        { type: 'DECRYPTED', plaintext, id: req.id },
        [plaintext.buffer]
      );
    }
  } catch (err: any) {
    self.postMessage({
      type: 'ERROR',
      message: err.message || 'Crypto worker operation failed',
      id: req.id,
    });
  }
};
