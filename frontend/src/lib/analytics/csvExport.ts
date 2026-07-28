/**
 * RFC 4180 CSV Serializer with UTF-8 BOM for Excel compatibility.
 */

import { logExportAction } from '$lib/gdpr/exportAudit';

export interface CsvExportRow {
  studentPseudonymId: string;
  fallbackCode: string;
  totalScore: number | string;
}

/**
 * Serialize student grade records to RFC 4180 CSV format and trigger browser file download.
 */
export async function exportGradesToCsv(
  examId: string,
  examTitle: string,
  rows: CsvExportRow[]
): Promise<void> {
  // 1. Audit log export action
  await logExportAction(examId, 'CSV');

  // 2. Build RFC 4180 CSV string
  let csvContent = 'Pseudonym ID,Fallback Code,Total Score\r\n';

  rows.forEach((row) => {
    const escapedId = `"${row.studentPseudonymId.replace(/"/g, '""')}"`;
    const escapedCode = `"${row.fallbackCode.replace(/"/g, '""')}"`;
    const score = row.totalScore;
    csvContent += `${escapedId},${escapedCode},${score}\r\n`;
  });

  // UTF-8 BOM (\uFEFF) ensures Excel opens non-ASCII characters cleanly
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const textBytes = new TextEncoder().encode(csvContent);
  const blob = new Blob([bom, textBytes], { type: 'text/csv;charset=utf-8;' });

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeFilename = examTitle.replace(/[^a-z0-9_-]/gi, '_');
  link.download = `${safeFilename}_grades.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
