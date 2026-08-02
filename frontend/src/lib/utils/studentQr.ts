/**
 * Parses student identity from QR code strings.
 *
 * Supported formats:
 *   - `Lastname, Firstname_NumericID`
 *   - `BG:Lastname, Firstname_NumericID:version:fallbackCode`
 *   - `Lastname_NumericID` (no first name)
 */

export interface ParsedStudentQr {
  lastname: string;
  firstname: string;
  studentNumber: string;
  displayName: string;
}

export function parseStudentQr(
  qrString: string | null | undefined,
): ParsedStudentQr | null {
  if (!qrString || typeof qrString !== 'string') return null;

  let target = qrString.trim();

  // Strip `BG:` prefix if present (BlindGrade format)
  if (target.startsWith('BG:')) {
    const parts = target.split(':');
    if (parts.length >= 2) {
      target = parts[1];
    }
  }

  // Split on the last underscore to separate name from student number
  const underscoreIdx = target.lastIndexOf('_');
  if (underscoreIdx === -1) return null;

  const namePart = target.substring(0, underscoreIdx).trim();
  const studentNumber = target.substring(underscoreIdx + 1).trim();

  if (!namePart) return null;

  // Split name on comma: "Lastname, Firstname"
  const commaIdx = namePart.indexOf(',');
  if (commaIdx === -1) {
    return {
      lastname: namePart,
      firstname: '',
      studentNumber,
      displayName: namePart,
    };
  }

  const lastname = namePart.substring(0, commaIdx).trim();
  const firstname = namePart.substring(commaIdx + 1).trim();
  const displayName = firstname ? `${lastname}, ${firstname}` : lastname;

  return {
    lastname,
    firstname,
    studentNumber,
    displayName,
  };
}
