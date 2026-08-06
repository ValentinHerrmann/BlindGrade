import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptSubmission, decryptSubmission } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { SubmissionRecord } from '$lib/db/schema';
import { uint8ArrayToBase64, base64ToUint8Array } from '$lib/crypto/aesGcm';
import { ensure64CharHex } from '$lib/crypto/hmac';
import { examRepository } from '$lib/repositories/examRepository';

export const submissionRepository = {
  async getAll(key: CryptoKey | null): Promise<SubmissionRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.submissions.toArray();
      return Promise.all(raw.map((sub) => decryptSubmission(sub, key)));
    } else {
      // Remote mode: backend has no /submissions endpoint, so fetch per-exam
      try {
        const exams = await examRepository.getAll(key);
        const allSubmissions: SubmissionRecord[] = [];
        for (const exam of exams) {
          const rawList = await api.get<any[]>(`/exams/${exam.id}/submissions`);
          allSubmissions.push(...rawList.map((s: any) => ({
            id: s.id,
            examId: s.exam_id || exam.id,
            pseudonymHash: s.pseudonym_hmac || s.pseudonymHash,
            totalScore: s.total_score ?? s.totalScore,
            createdAt: s.created_at || s.createdAt || new Date().toISOString(),
            scanCt: s.scan_ciphertext_b64 ? base64ToUint8Array(s.scan_ciphertext_b64) : undefined,
            scanIv: s.scan_iv_b64 ? base64ToUint8Array(s.scan_iv_b64) : undefined,
            annotationCt: s.annotation_ciphertext_b64 ? base64ToUint8Array(s.annotation_ciphertext_b64) : undefined,
            annotationIv: s.annotation_iv_b64 ? base64ToUint8Array(s.annotation_iv_b64) : undefined,
          })));
        }
        return allSubmissions;
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
          totalScore: s.total_score ?? s.totalScore,
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
          totalScore: s.total_score ?? s.totalScore,
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
        total_score: submission.totalScore ?? null,
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

    // Always clean up associated exercise scores to prevent orphaned data
    // from polluting analytics
    const scores = await db.exerciseScores.where('submissionId').equals(id).toArray();
    for (const score of scores) {
      await db.exerciseScores.delete(score.id);
    }

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

  async clearGrading(examId: string, id: string, key: CryptoKey | null): Promise<void> {
    const policy = get(storagePolicyStore);

    // Delete all exercise scores for this submission to prevent orphaned scores
    // from polluting analytics
    const scores = await db.exerciseScores.where('submissionId').equals(id).toArray();
    for (const score of scores) {
      await db.exerciseScores.delete(score.id);
    }

    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      // Must decrypt → modify → re-encrypt → save, because submissions are stored
      // encrypted in IndexedDB. Directly updating the encrypted record won't work
      // since fields like totalScore don't exist at the encrypted storage level.
      const raw = await db.submissions.get(id);
      if (!raw) return;
      const sub = await decryptSubmission(raw, key);
      sub.totalScore = undefined;
      sub.annotationCt = undefined;
      sub.annotationIv = undefined;
      const encrypted = await encryptSubmission(sub, key);
      await db.submissions.put(encrypted);
    } else {
      const sub = await this.getById(examId, id, key);
      if (!sub) return;
      const pseudonymHmac = await ensure64CharHex(sub.pseudonymHash);
      const payload = {
        id: sub.id,
        pseudonym_hmac: pseudonymHmac,
        total_score: null,
        scan_ciphertext_b64: sub.scanCt ? uint8ArrayToBase64(sub.scanCt) : undefined,
        scan_iv_b64: sub.scanIv ? uint8ArrayToBase64(sub.scanIv) : undefined,
      };
      try {
        await api.post(`/exams/${examId}/submissions`, payload);
      } catch {
        enqueueRequest(`/exams/${examId}/submissions`, 'POST', payload);
      }
    }
  },
};
