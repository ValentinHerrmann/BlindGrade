/**
 * Web Worker for DEFLATE compression/decompression using fflate.
 */

import { deflateSync, inflateSync } from 'fflate';

export type PackWorkerMessage =
  | { type: 'COMPRESS'; data: Uint8Array; id: number }
  | { type: 'DECOMPRESS'; data: Uint8Array; id: number };

export type PackWorkerResponse =
  | { type: 'COMPRESSED'; data: Uint8Array; id: number }
  | { type: 'DECOMPRESSED'; data: Uint8Array; id: number }
  | { type: 'ERROR'; message: string; id: number };

self.onmessage = (event: MessageEvent<PackWorkerMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'COMPRESS') {
      const compressed = deflateSync(msg.data, { level: 6 });
      self.postMessage({ type: 'COMPRESSED', data: compressed, id: msg.id }, [compressed.buffer]);
    } else if (msg.type === 'DECOMPRESS') {
      const decompressed = inflateSync(msg.data);
      self.postMessage({ type: 'DECOMPRESSED', data: decompressed, id: msg.id }, [decompressed.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ type: 'ERROR', message: err.message || 'Worker processing failed', id: msg.id });
  }
};
