/**
 * IndexedDB schema type definitions for Dexie.
 *
 * SECURITY: All *_ct (ciphertext) fields are Uint8Array encrypted before IDB write.
 * Decryption happens at point of use only — never stored decrypted.
 *
 * Encryption-at-rest is the PRIMARY protection against data leakage on shared machines.
 * The IDB wipe in hygiene.ts is best-effort UX — not relied upon for security.
 */

export interface ExamRecord {
  id: string;            // UUID
  teacherId: string;
  title?: string;
  testart?: string;
  klasse?: string;
  datum?: string;
  nr?: string;
  fach?: string;
  lehrernachname?: string;
  infoText?: string;
  latexPreamble?: string;
  latexTemplate?: string;
  numVersions?: number;
  retentionUntil: string;  // ISO date string
  compilationStatus: 'pending' | 'compiled' | 'failed';
  createdAt: string;
  isDirty?: boolean;
  /** AES-256-GCM encrypted payload containing title, metadata, & LaTeX templates. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}

export interface ExerciseRecord {
  id: string;            // UUID
  teacherId?: string;
  examId?: string;
  orderIndex?: number;
  title?: string;
  name?: string;
  latexBody?: string;
  maxPoints: number;
  topicTag?: string;
  grade?: string;
  subject?: string;
  version?: number;
  exerciseGroupId?: string;
  variantKey?: string;
  isCurrent?: boolean;
  createdAt?: string;
  updatedAt?: string;
  questionType: 'free_text' | 'mc' | 'sc' | 'tf';
  options?: string[];
  correctAnswers?: number[];
  penalty: number;
  /** AES-256-GCM encrypted payload containing title, name, latexBody, options, correctAnswers. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}

export interface ExamExerciseRecord {
  examId: string;
  exerciseId: string;
  orderIndex: number;
}

export interface ExerciseScoreRecord {
  id: string;               // UUID
  submissionId: string;
  exerciseId: string;
  score?: number;
  selectedOptions?: number[];
  /** AES-256-GCM encrypted payload containing score and selectedOptions. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}

export interface StudentRecord {
  /** Raw pseudonym UUID — only in local IDB, never sent to server. */
  pseudonymId: string;
  examId: string;
  /** Human-readable fallback code (e.g. "A-X7K2M9") for unreadable QR codes. */
  fallbackCode?: string;
  /** AES-256-GCM ciphertext of PII (name, student number, etc.). */
  piiCt: Uint8Array;
  /** 12-byte GCM IV for piiCt. */
  piiIv: Uint8Array;
  /** AES-256-GCM encrypted payload containing fallbackCode. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}

export interface SubmissionRecord {
  id: string;            // UUID
  examId: string;
  /** HMAC(pseudonymId, archiveSecret) — links to StudentRecord without exposing raw ID. */
  pseudonymHash: string;
  totalScore?: number;
  /** AES-256-GCM ciphertext of scan image blob. */
  scanCt?: Uint8Array;
  scanIv?: Uint8Array;
  /** AES-256-GCM ciphertext of annotation JSON vector layer. */
  annotationCt?: Uint8Array;
  annotationIv?: Uint8Array;
  createdAt: string;
  /** AES-256-GCM encrypted payload containing totalScore. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}

export interface AuditEntry {
  id: string;            // UUID
  action: 'LOGIN' | 'EXPORT' | 'DELETE' | 'VIEW' | 'EXTEND_RETENTION';
  targetId?: string;
  timestamp: string;     // ISO datetime
  note?: string;
  /** AES-256-GCM encrypted payload containing note. */
  payloadCt?: Uint8Array;
  /** 12-byte GCM IV for payloadCt. */
  payloadIv?: Uint8Array;
}
