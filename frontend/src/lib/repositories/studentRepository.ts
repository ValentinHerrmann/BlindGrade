import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptStudent, decryptStudent } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { StudentRecord } from '$lib/db/schema';
import { uint8ArrayToBase64 } from '$lib/crypto/aesGcm';
import { ensure64CharHex } from '$lib/crypto/hmac';

export const studentRepository = {
  async getAll(key: CryptoKey | null): Promise<StudentRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.students.toArray();
      return Promise.all(raw.map((st) => decryptStudent(st, key)));
    } else {
      try {
        const rawList = await api.get<any[]>('/students');
        return rawList.map((st: any) => ({
          pseudonymId: st.pseudonym_hmac || st.pseudonymId,
          examId: st.exam_id || st.examId || '',
          fallbackCode: st.fallback_code || st.fallbackCode,
          piiCt: st.pii_ciphertext_b64 ? Uint8Array.from(atob(st.pii_ciphertext_b64), (c) => c.charCodeAt(0)) : new Uint8Array(0),
          piiIv: st.iv_b64 ? Uint8Array.from(atob(st.iv_b64), (c) => c.charCodeAt(0)) : new Uint8Array(12),
        }));
      } catch {
        return [];
      }
    }
  },

  async getByExamId(examId: string, key: CryptoKey | null): Promise<StudentRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const raw = await db.students.where('examId').equals(examId).toArray();
      return Promise.all(raw.map((st) => decryptStudent(st, key)));
    } else {
      try {
        const rawList = await api.get<any[]>(`/exams/${examId}/students`);
        return rawList.map((st: any) => ({
          pseudonymId: st.pseudonym_hmac || st.pseudonymId,
          examId: st.exam_id || examId,
          fallbackCode: st.fallback_code || st.fallbackCode,
          piiCt: st.pii_ciphertext_b64 ? Uint8Array.from(atob(st.pii_ciphertext_b64), (c) => c.charCodeAt(0)) : new Uint8Array(0),
          piiIv: st.iv_b64 ? Uint8Array.from(atob(st.iv_b64), (c) => c.charCodeAt(0)) : new Uint8Array(12),
        }));
      } catch {
        return [];
      }
    }
  },

  async save(student: StudentRecord, key: CryptoKey | null): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      const encrypted = await encryptStudent(student, key);
      await db.students.put(encrypted);
    } else {
      const pseudonymHmac = await ensure64CharHex(student.pseudonymId);
      const payload = {
        pseudonym_hmac: pseudonymHmac,
        pii_ciphertext_b64: uint8ArrayToBase64(student.piiCt),
        iv_b64: uint8ArrayToBase64(student.piiIv),
        encryption_salt_b64: uint8ArrayToBase64(new Uint8Array(16)),
      };
      try {
        await api.post(`/exams/${student.examId}/students`, payload);
      } catch {
        enqueueRequest(`/exams/${student.examId}/students`, 'POST', payload);
      }
    }
  },

  async delete(pseudonymId: string): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local' || policy.storageMode === 'hybrid') {
      await db.students.delete(pseudonymId);
    } else {
      try {
        await api.delete(`/students/${pseudonymId}`);
      } catch {
        enqueueRequest(`/students/${pseudonymId}`, 'DELETE');
      }
    }
  },
};
