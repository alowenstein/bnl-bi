import * as XLSX from 'xlsx';
import { StudentRow } from '@/types/student';

const HEADER_MAP: Record<string, keyof StudentRow> = {
  'student name': 'studentName',
  'parent email': 'parentEmail',
  'drop-off time': 'dropOffTime',
  'drop off time': 'dropOffTime',
  'dropoff time': 'dropOffTime',
  'pick-up time': 'pickUpTime',
  'pick up time': 'pickUpTime',
  'pickup time': 'pickUpTime',
  'total hours': 'totalHours',
};

export function parseExcelBuffer(buffer: Buffer): StudentRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (rows.length === 0) return [];

  return rows.map((row) => {
    const student: Partial<StudentRow> = {};

    for (const [key, value] of Object.entries(row)) {
      const normalized = key.trim().toLowerCase();
      const field = HEADER_MAP[normalized];
      if (field) {
        student[field] = String(value);
      }
    }

    return {
      studentName: student.studentName ?? '',
      parentEmail: student.parentEmail ?? '',
      dropOffTime: student.dropOffTime ?? '',
      pickUpTime: student.pickUpTime ?? '',
      totalHours: student.totalHours ?? '',
    };
  });
}
