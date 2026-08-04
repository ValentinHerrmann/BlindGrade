import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptStudent, decryptStudent } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { StudentRecord } from '$lib/db/schema';
import { uint8ArrayToBase64, base64ToUint8Array } from '$lib/crypto/aesGcm';
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
          piiCt: st.pii_ciphertext_b64 ? base64ToUint8Array(st.pii_ciphertext_b64) : new Uint8Array(0),
          piiIv: st.iv_b64 ? base64ToUint8Array(st.iv_b64) : new Uint8Array(12),
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
        const serverStudents = await Promise.all(rawList.map(async (st: any) => {
          const payloadCt = st.pii_ciphertext_b64 ? base64ToUint8Array(st.pii_ciphertext_b64) : undefined;
          const payloadIv = st.iv_b64 ? base64ToUint8Array(st.iv_b64) : undefined;
          const rec: StudentRecord = {
            pseudonymId: st.pseudonym_hmac || st.pseudonymId,
            examId: st.exam_id || examId,
            fallbackCode: st.fallback_code || st.fallbackCode,
            piiCt: payloadCt || new Uint8Array(0),
            piiIv: payloadIv || new Uint8Array(12),
            payloadCt,
            payloadIv,
          };
          return decryptStudent(rec, key);
        }));
        const localRaw = await db.students.where('examId').equals(examId).toArray();
        const localStudents = await Promise.all(localRaw.map((st) => decryptStudent(st, key)));
        const combinedMap = new Map<string, StudentRecord>();
        const hmacToKeyMap = new Map<string, string>();

        for (const st of serverStudents) {
          combinedMap.set(st.pseudonymId, st);
          hmacToKeyMap.set(st.pseudonymId, st.pseudonymId);
        }

        for (const st of localStudents) {
          const localHmac = await ensure64CharHex(st.pseudonymId);
          const existingKey = combinedMap.has(st.pseudonymId)
            ? st.pseudonymId
            : hmacToKeyMap.get(localHmac);

          if (!existingKey) {
            combinedMap.set(st.pseudonymId, st);
            hmacToKeyMap.set(localHmac, st.pseudonymId);
          } else {
            const existing = combinedMap.get(existingKey)!;
            const merged: StudentRecord = {
              ...existing,
              pseudonymId: st.pseudonymId || existing.pseudonymId,
              studentName: st.studentName || existing.studentName,
              studentNumber: st.studentNumber || existing.studentNumber,
              fallbackCode: st.fallbackCode || existing.fallbackCode,
            };
            combinedMap.delete(existingKey);
            combinedMap.set(merged.pseudonymId, merged);
            hmacToKeyMap.set(localHmac, merged.pseudonymId);
          }
        }
        return Array.from(combinedMap.values());
      } catch {
        const raw = await db.students.where('examId').equals(examId).toArray();
        return Promise.all(raw.map((st) => decryptStudent(st, key)));
      }
    }
  },

  async save(student: StudentRecord, key: CryptoKey | null): Promise<void> {
    const encrypted = await encryptStudent(student, key);
    await db.students.put(encrypted);
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-server') {
      const pseudonymHmac = await ensure64CharHex(student.pseudonymId);
      const payload = {
        pseudonym_hmac: pseudonymHmac,
        pii_ciphertext_b64: encrypted.payloadCt ? uint8ArrayToBase64(encrypted.payloadCt) : uint8ArrayToBase64(student.piiCt),
        iv_b64: encrypted.payloadIv ? uint8ArrayToBase64(encrypted.payloadIv) : uint8ArrayToBase64(student.piiIv),
        encryption_salt_b64: uint8ArrayToBase64(new Uint8Array(16)),
      };
      try {
        await api.post(`/exams/${student.examId}/students`, payload);
      } catch {
        enqueueRequest(`/exams/${student.examId}/students`, 'POST', payload);
      }
    }
  },

  async delete(examIdOrPseudonymId: string, pseudonymIdArg?: string): Promise<void> {
    let examId = examIdOrPseudonymId;
    let pseudonymId = pseudonymIdArg;
    if (!pseudonymId) {
      pseudonymId = examIdOrPseudonymId;
      examId = '';
    }
    const pseudonymHmac = await ensure64CharHex(pseudonymId);

    // Delete locally from IndexedDB in all modes to keep local state clean
    await db.students.delete(pseudonymId);
    await db.students.delete(pseudonymHmac);

    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-server') {
      const url = examId ? `/exams/${examId}/students/${pseudonymHmac}` : `/students/${pseudonymHmac}`;
      try {
        await api.delete(url);
      } catch {
        enqueueRequest(url, 'DELETE');
      }
    }
  },
};
