/**
 * .bgproj Archive Format Definition.
 *
 * Header layout:
 *   [4 bytes]  Magic: 0x42 0x47 0x50 0x4A ("BGPJ")
 *   [1 byte]   Format version: 0x01
 *   [16 bytes] Argon2id salt (for key re-derivation)
 *   [12 bytes] AES-GCM nonce (for outer envelope)
 *   [8 bytes]  Ciphertext length (uint64 LE)
 *   [N bytes]  AES-GCM ciphertext of inner bundle
 *   [16 bytes] AES-GCM authentication tag (appended by Web Crypto API)
 */

export const MAGIC_BYTES = new Uint8Array([0x42, 0x47, 0x50, 0x4a]); // "BGPJ"
export const FORMAT_VERSION = 0x01;
export const ARCHIVE_SECRET_PURPOSE = 'bgproj-link';

export enum RecordType {
  MANIFEST = 1,
  EXAM = 2,
  EXERCISE = 3,
  STUDENT = 4,
  SUBMISSION = 5,
  AUDITLOG = 6,
  EXERCISESCORE = 7,
  EXAMEXERCISE = 8,
}

export interface ArchiveManifest {
  version: string;
  created_at: string;
  expires_at: string;
  mode: 'local' | 'hybrid';
  exam_count: number;
  student_count: number;
  records_checksum: string; // SHA-256 hex of all subsequent record payload bytes concatenated
}

export interface ArchiveRecord {
  type: RecordType;
  payload: Uint8Array; // Raw JSON or binary payload
}

export interface ProgressEventData {
  stage: 'salt' | 'encrypt' | 'compress' | 'writing' | 'unpacking' | 'verifying' | 'complete';
  current: number;
  total: number;
  heapUsedMB?: number;
}
