import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email-sender';
import { StudentRow, SendResult } from '@/types/student';

export async function POST(req: NextRequest) {
  const { rows, template }: { rows: StudentRow[]; template: string } = await req.json();

  if (!rows?.length) {
    return NextResponse.json({ error: 'No rows provided.' }, { status: 400 });
  }
  if (!template?.trim()) {
    return NextResponse.json({ error: 'No email template provided.' }, { status: 400 });
  }

  const results: SendResult[] = [];

  for (const student of rows) {
    try {
      await sendEmail(student, template);
      results.push({ email: student.parentEmail, studentName: student.studentName, status: 'sent' });
    } catch (err) {
      results.push({
        email: student.parentEmail,
        studentName: student.studentName,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ results });
}
