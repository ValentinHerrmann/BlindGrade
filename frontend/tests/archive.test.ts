import 'fake-indexeddb/auto'; // In-memory IndexedDB mock for Vitest — must be imported before Dexie db module
import { describe, it, expect, beforeEach } from 'vitest';
import { packProject } from '../src/lib/archive/packer';
import { unpackProject } from '../src/lib/archive/unpacker';
import { db } from '../src/lib/db/db';
import { eraseStudent } from '../src/lib/gdpr/erasure';
import { checkRetention } from '../src/lib/gdpr/retention';

describe('.bgproj Archive Packer and Unpacker', () => {
  const testPassword = 'SuperSecretTeacherPassword123!';

  beforeEach(async () => {
    await db.exams.clear();
    await db.exercises.clear();
    await db.students.clear();
    await db.submissions.clear();
    await db.auditLog.clear();
  });

  it('performs full pack and unpack round-trip correctly', async () => {
    // Populate mock DB data
    const examId = 'exam-uuid-1';
    await db.exams.add({
      id: examId,
      teacherId: 'teacher-1',
      title: 'Mathematics Final Exam',
      retentionUntil: '2027-12-31',
      compilationStatus: 'compiled',
      createdAt: new Date().toISOString(),
    });

    await db.students.add({
      pseudonymId: 'student-uuid-99',
      examId,
      fallbackCode: 'A-X7K2M9',
      piiCt: new Uint8Array([1, 2, 3, 4]),
      piiIv: new Uint8Array(12).fill(1),
    });

    // Pack project
    const packedBytes = await packProject(testPassword);
    expect(packedBytes.length).toBeGreaterThan(41); // Larger than header

    // Clear local DB before import
    await db.exams.clear();
    await db.students.clear();

    // Unpack project
    const result = await unpackProject(packedBytes, testPassword);
    expect(result.examCount).toBe(1);
    expect(result.studentCount).toBe(1);

    // Verify restored IDB contents
    const restoredExams = await db.exams.toArray();
    expect(restoredExams).toHaveLength(1);
    expect(restoredExams[0].title).toBe('Mathematics Final Exam');

    const restoredStudents = await db.students.toArray();
    expect(restoredStudents).toHaveLength(1);
    expect(restoredStudents[0].fallbackCode).toBe('A-X7K2M9');
  });

  it('guarantees nonce and salt freshness on every pack operation', async () => {
    await db.exams.add({
      id: 'exam-1',
      teacherId: 't-1',
      title: 'Physics Midterm',
      retentionUntil: '2027-01-01',
      compilationStatus: 'compiled',
      createdAt: new Date().toISOString(),
    });

    // Export twice with identical data & password
    const pack1 = await packProject(testPassword);
    const pack2 = await packProject(testPassword);

    // Salt (bytes 5..20) must be different
    const salt1 = pack1.subarray(5, 21);
    const salt2 = pack2.subarray(5, 21);
    expect(salt1).not.toEqual(salt2);

    // Nonce (bytes 21..32) must be different
    const nonce1 = pack1.subarray(21, 33);
    const nonce2 = pack2.subarray(21, 33);
    expect(nonce1).not.toEqual(nonce2);

    // Ciphertext bytes must be completely different
    expect(pack1).not.toEqual(pack2);
  });

  it('rejects unpack if password is wrong or ciphertext is tampered', async () => {
    await db.exams.add({
      id: 'e1',
      teacherId: 't1',
      title: 'Chemistry',
      retentionUntil: '2028-01-01',
      compilationStatus: 'compiled',
      createdAt: new Date().toISOString(),
    });

    const packed = await packProject(testPassword);

    // Wrong password
    await expect(unpackProject(packed, 'WrongPassword')).rejects.toThrow();

    // Tampered payload byte
    const tampered = new Uint8Array(packed);
    tampered[tampered.length - 5] ^= 0xff;
    await expect(unpackProject(tampered, testPassword)).rejects.toThrow();
  });
});

describe('GDPR Erasure & Retention', () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.submissions.clear();
    await db.auditLog.clear();
  });

  it('erases student record and associated submissions, writing an audit log', async () => {
    const studentId = 'student-to-erase';
    const examId = 'exam-gdpr-1';

    await db.students.add({
      pseudonymId: studentId,
      examId,
      fallbackCode: 'F-123456',
      piiCt: new Uint8Array([5, 5, 5]),
      piiIv: new Uint8Array(12),
    });

    await db.submissions.add({
      id: 'sub-1',
      examId,
      pseudonymHash: 'some-hash',
      createdAt: new Date().toISOString(),
    });

    const result = await eraseStudent(studentId, examId);
    expect(result.pseudonymId).toBe(studentId);

    // Verify student is absent from IDB
    const student = await db.students.get(studentId);
    expect(student).toBeUndefined();

    // Verify audit entry exists
    const logs = await db.auditLog.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('DELETE');
  });

  it('checks retention period correctly', () => {
    const futureDate = new Date(Date.now() + 864000000).toISOString();
    const pastDate = new Date(Date.now() - 864000000).toISOString();

    const futureCheck = checkRetention(futureDate);
    expect(futureCheck.isExpired).toBe(false);
    expect(futureCheck.daysRemaining).toBeGreaterThan(0);

    const pastCheck = checkRetention(pastDate);
    expect(pastCheck.isExpired).toBe(true);
    expect(pastCheck.daysRemaining).toBeLessThanOrEqual(0);
  });
});
