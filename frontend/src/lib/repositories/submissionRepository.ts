import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptSubmission, decryptSubmission } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { SubmissionRecord } from '$lib/db/schema';
import { uint8ArrayToBase64, base64ToUint8Array } from '$lib/crypto/aesGcm';
import { ensure64CharHex } from '$lib/crypto/hmac';

export const submissionRepository = {
  async getAll(key: CryptoKey | null): Promise<SubmissionRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.submissions.toArray();
      return Promise.all(raw.map((sub) => decryptSubmission(sub, key)));
    } else {
      try {
        const rawList = await api.get<any[]>('/submissions');
        return rawList.map((s: any) => ({
          id: s.id,
          examId: s.exam_id || s.examId,
          pseudonymHash: s.pseudonym_hmac || s.pseudonymHash,
          totalScore: s.total_score ?? s.totalScore ?? 0,
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
        }));
      } catch {
        return [];
      }
    }
  },

  async getByExamId(examId: string, key: CryptoKey | null): Promise<SubmissionRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.submissions.where('examId').equals(examId).toArray();
      return Promise.all(raw.map((sub) => decryptSubmission(sub, key)));
    } else {
      try {
        const rawList = await api.get<any[]>(`/exams/${examId}/submissions`);
        return rawList.map((s: any) => ({
          id: s.id,
          examId: s.exam_id || examId,
          pseudonymHash: s.pseudonym_hmac || s.pseudonymHash,
          totalScore: s.total_score ?? s.totalScore ?? 0,
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
          scanCt: s.scan_ciphertext_b64 ? base64ToUint8Array(s.scan_ciphertext_b64) : undefined,
          scanIv: s.scan_iv_b64 ? base64ToUint8Array(s.scan_iv_b64) : undefined,
          annotationCt: s.annotation_ciphertext_b64 ? base64ToUint8Array(s.annotation_ciphertext_b64) : undefined,
          annotationIv: s.annotation_iv_b64 ? base64ToUint8Array(s.annotation_iv_b64) : undefined,
        }));
      } catch {
        return [];
      }
    }
  },

  async getById(examId: string, id: string, key: CryptoKey | null): Promise<SubmissionRecord | null> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.submissions.get(id);
      return raw ? decryptSubmission(raw, key) : null;
    } else {
      try {
        const s = await api.get<any>(`/exams/${examId}/submissions/${id}`);
        return {
          id: s.id,
          examId: s.exam_id || examId,
          pseudonymHash: s.pseudonym_hmac || s.pseudonymHash,
          totalScore: s.total_score ?? s.totalScore ?? 0,
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
          scanCt: s.scan_ciphertext_b64 ? base64ToUint8Array(s.scan_ciphertext_b64) : undefined,
          scanIv: s.scan_iv_b64 ? base64ToUint8Array(s.scan_iv_b64) : undefined,
          annotationCt: s.annotation_ciphertext_b64 ? base64ToUint8Array(s.annotation_ciphertext_b64) : undefined,
          annotationIv: s.annotation_iv_b64 ? base64ToUint8Array(s.annotation_iv_b64) : undefined,
        };
      } catch {
        return null;
      }
    }
  },

  async save(submission: SubmissionRecord, key: CryptoKey | null): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const encrypted = await encryptSubmission(submission, key);
      await db.submissions.put(encrypted);
    } else {
      const pseudonymHmac = await ensure64CharHex(submission.pseudonymHash);
      const payload = {
        id: submission.id,
        pseudonym_hmac: pseudonymHmac,
        total_score: submission.totalScore || 0,
        scan_ciphertext_b64: submission.scanCt ? uint8ArrayToBase64(submission.scanCt) : undefined,
        scan_iv_b64: submission.scanIv ? uint8ArrayToBase64(submission.scanIv) : undefined,
        annotation_ciphertext_b64: submission.annotationCt ? uint8ArrayToBase64(submission.annotationCt) : undefined,
        annotation_iv_b64: submission.annotationIv ? uint8ArrayToBase64(submission.annotationIv) : undefined,
      };
      try {
        await api.post(`/exams/${submission.examId}/submissions`, payload);
      } catch {
        enqueueRequest(`/exams/${submission.examId}/submissions`, 'POST', payload);
      }
    }
  },

  async delete(examId: string, id: string): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      await db.submissions.delete(id);
    } else {
      try {
        await api.delete(`/exams/${examId}/submissions/${id}`);
      } catch {
        enqueueRequest(`/exams/${examId}/submissions/${id}`, 'DELETE');
      }
    }
  },
};
