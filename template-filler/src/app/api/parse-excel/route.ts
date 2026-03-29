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

  try {
    const { rows, warnings } = parseExcelBuffer(buffer);
    return NextResponse.json({ rows, warnings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse file.' },
      { status: 422 }
    );
  }
}
