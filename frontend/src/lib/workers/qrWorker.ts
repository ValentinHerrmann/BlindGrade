import { readBarcodesFromImageData } from 'zxing-wasm/reader';

export interface QrWorkerRequest {
  type: 'QR_DECODE';
  imageData: ImageData;
}

export type QrWorkerResponse =
  | { type: 'QR_RESULT'; pseudonymId: string; version: string; fallbackCode?: string; rawText?: string }
  | { type: 'ERROR'; message: string };

self.onmessage = async (event: MessageEvent<QrWorkerRequest>) => {
  const { imageData } = event.data;
  try {
    // 1. Try ZXing WASM barcode reader first
    try {
      const results = await readBarcodesFromImageData(imageData, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
      });
      if (results && results.length > 0) {
        const rawValue = results[0].text;
        const parts = rawValue.split(':');
        if (parts[0] === 'BG' && parts.length >= 3) {
          self.postMessage({
            type: 'QR_RESULT',
            pseudonymId: parts[1],
            version: parts[2],
            fallbackCode: parts[3],
            rawText: rawValue,
          });
          return;
        } else {
          // General QR code payload (e.g. external QR sticker containing name/id)
          self.postMessage({
            type: 'QR_RESULT',
            pseudonymId: rawValue,
            version: 'A',
            fallbackCode: rawValue.substring(0, 8),
            rawText: rawValue,
          });
          return;
        }
      }
    } catch (wasmErr) {
      console.warn('ZXing-wasm decode error, trying BarcodeDetector fallback:', wasmErr);
    }

    // 2. Native BarcodeDetector fallback if available
    if ('BarcodeDetector' in self) {
      const detector = new (self as any).BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(imageData);
      if (barcodes.length > 0) {
        const rawValue = barcodes[0].rawValue;
        const parts = rawValue.split(':');
        if (parts[0] === 'BG' && parts.length >= 3) {
          self.postMessage({
            type: 'QR_RESULT',
            pseudonymId: parts[1],
            version: parts[2],
            fallbackCode: parts[3],
            rawText: rawValue,
          });
          return;
        } else {
          self.postMessage({
            type: 'QR_RESULT',
            pseudonymId: rawValue,
            version: 'A',
            fallbackCode: rawValue.substring(0, 8),
            rawText: rawValue,
          });
          return;
        }
      }
    }

    self.postMessage({
      type: 'ERROR',
      message: 'No readable QR code found on page.',
    });
  } catch (err: any) {
    self.postMessage({
      type: 'ERROR',
      message: err.message || 'QR decoding error',
    });
  }
};
