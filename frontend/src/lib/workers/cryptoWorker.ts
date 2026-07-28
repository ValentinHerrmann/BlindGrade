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

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  const req = event.data;
  try {
    if (req.type === 'ENCRYPT') {
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);

      const ctBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        req.key,
        req.plaintext.buffer as ArrayBuffer
      );
      const ciphertext = new Uint8Array(ctBuffer);

      self.postMessage(
        { type: 'ENCRYPTED', ciphertext, iv, id: req.id },
        [ciphertext.buffer]
      );
    } else if (req.type === 'DECRYPT') {
      const ptBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: req.iv.buffer as ArrayBuffer },
        req.key,
        req.ciphertext.buffer as ArrayBuffer
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
