import { describe, it, expect } from 'vitest';
import { parseStudentQr } from '$lib/utils/studentQr';

describe('parseStudentQr', () => {
  describe('standard format: "Lastname, Firstname_NumericID"', () => {
    it('parses full name and student number correctly', () => {
      const result = parseStudentQr('Mustermann, Erika_123456');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Mustermann');
      expect(result!.firstname).toBe('Erika');
      expect(result!.studentNumber).toBe('123456');
      expect(result!.displayName).toBe('Mustermann, Erika');
    });

    it('handles names with extra whitespace', () => {
      const result = parseStudentQr('  Mustermann ,  Erika  _  123456  ');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Mustermann');
      expect(result!.firstname).toBe('Erika');
      expect(result!.studentNumber).toBe('123456');
      expect(result!.displayName).toBe('Mustermann, Erika');
    });

    it('parses multi-part last names', () => {
      const result = parseStudentQr('Van Der Berg, Hans_998877');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Van Der Berg');
      expect(result!.firstname).toBe('Hans');
      expect(result!.studentNumber).toBe('998877');
      expect(result!.displayName).toBe('Van Der Berg, Hans');
    });
  });

  describe('BlindGrade format: "BG:Lastname, Firstname_NumericID:version:fallbackCode"', () => {
    it('parses BG-prefixed QR string correctly', () => {
      const result = parseStudentQr('BG:Smith, John_987654:A:F-123');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Smith');
      expect(result!.firstname).toBe('John');
      expect(result!.studentNumber).toBe('987654');
      expect(result!.displayName).toBe('Smith, John');
    });

    it('handles BG format with underscores in fallback code', () => {
      const result = parseStudentQr('BG:Müller, Anna_112233:B:FB_456');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Müller');
      expect(result!.firstname).toBe('Anna');
      expect(result!.studentNumber).toBe('112233');
      expect(result!.displayName).toBe('Müller, Anna');
    });
  });

  describe('format without comma: "Lastname_NumericID"', () => {
    it('parses name without first name', () => {
      const result = parseStudentQr('Mustermann_123');
      expect(result).not.toBeNull();
      expect(result!.lastname).toBe('Mustermann');
      expect(result!.firstname).toBe('');
      expect(result!.studentNumber).toBe('123');
      expect(result!.displayName).toBe('Mustermann');
    });
  });

  describe('invalid inputs', () => {
    it('returns null for null input', () => {
      expect(parseStudentQr(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseStudentQr(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseStudentQr('')).toBeNull();
    });

    it('returns null for raw UUID (no underscore)', () => {
      expect(parseStudentQr('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    });

    it('returns null for string with only spaces', () => {
      expect(parseStudentQr('   ')).toBeNull();
    });
  });
});
