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

const REQUIRED_FIELDS: Array<{ field: keyof StudentRow; label: string }> = [
  { field: 'studentName',  label: 'Student Name'  },
  { field: 'parentEmail',  label: 'Parent Email'  },
  { field: 'dropOffTime',  label: 'Drop-off Time' },
  { field: 'pickUpTime',   label: 'Pick-up Time'  },
  { field: 'totalHours',   label: 'Total Hours'   },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RowWarning {
  row: number;   // 1-based
  field: string;
  message: string;
}

export interface ParseResult {
  rows: StudentRow[];
  warnings: RowWarning[];
}

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (raw.length === 0) {
    throw new Error('The spreadsheet is empty — no data rows found.');
  }

  // Detect which fields are present from the first row's headers
  const firstRowKeys = Object.keys(raw[0]).map((k) => k.trim().toLowerCase());
  const mappedFields = new Set(
    firstRowKeys.map((k) => HEADER_MAP[k]).filter(Boolean)
  );

  const missingColumns = REQUIRED_FIELDS
    .filter(({ field }) => !mappedFields.has(field))
    .map(({ label }) => label);

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing required column${missingColumns.length > 1 ? 's' : ''}: ${missingColumns.join(', ')}.\n` +
      `Expected: Student Name, Parent Email, Drop-off Time, Pick-up Time, Total Hours.`
    );
  }

  const warnings: RowWarning[] = [];

  const rows: StudentRow[] = raw.map((raw_row, idx) => {
    const rowNum = idx + 2; // +2: header is row 1, data starts at 2
    const student: Partial<StudentRow> = {};

    for (const [key, value] of Object.entries(raw_row)) {
      const normalized = key.trim().toLowerCase();
      const field = HEADER_MAP[normalized];
      if (field) student[field] = String(value).trim();
    }

    const result: StudentRow = {
      studentName: student.studentName ?? '',
      parentEmail: student.parentEmail ?? '',
      dropOffTime: student.dropOffTime ?? '',
      pickUpTime:  student.pickUpTime  ?? '',
      totalHours:  student.totalHours  ?? '',
    };

    // Per-row warnings
    if (!result.studentName) {
      warnings.push({ row: rowNum, field: 'Student Name', message: 'Missing student name' });
    }
    if (!result.parentEmail) {
      warnings.push({ row: rowNum, field: 'Parent Email', message: 'Missing email address' });
    } else if (!EMAIL_RE.test(result.parentEmail)) {
      warnings.push({ row: rowNum, field: 'Parent Email', message: `Invalid email: "${result.parentEmail}"` });
    }
    if (!result.dropOffTime) {
      warnings.push({ row: rowNum, field: 'Drop-off Time', message: 'Missing drop-off time' });
    }
    if (!result.pickUpTime) {
      warnings.push({ row: rowNum, field: 'Pick-up Time', message: 'Missing pick-up time' });
    }
    if (!result.totalHours && result.totalHours !== 0) {
      warnings.push({ row: rowNum, field: 'Total Hours', message: 'Missing total hours' });
    }

    return result;
  });

  return { rows, warnings };
}
