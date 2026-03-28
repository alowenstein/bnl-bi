import { NextRequest, NextResponse } from 'next/server';
import { parseExcelBuffer } from '@/lib/excel-parser';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const rows = parseExcelBuffer(buffer);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found in the spreadsheet.' }, { status: 422 });
  }

  return NextResponse.json({ rows });
}
