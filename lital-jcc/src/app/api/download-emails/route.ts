import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { StudentRow } from '@/types/student';

function populateTemplate(template: string, student: StudentRow): string {
  const existingPlan = `Drop-off: ${student.dropOffTime} | Pick-up: ${student.pickUpTime}`;
  return template
    .replace(/\{\{student_name\}\}/g, student.studentName)
    .replace(/\{\{existing_plan\}\}/g, existingPlan)
    .replace(/\{\{total_hours\}\}/g, String(student.totalHours));
}

function toSafeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function buildEml(student: StudentRow, subject: string, htmlBody: string): string {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}`;
  const plainText = htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return [
    'MIME-Version: 1.0',
    `To: ${student.parentEmail}`,
    `Subject: ${subject}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    plainText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');
}

export async function POST(req: NextRequest) {
  const { rows, template, subject }: { rows: StudentRow[]; template: string; subject: string } =
    await req.json();

  if (!rows?.length) {
    return Response.json({ error: 'No rows provided.' }, { status: 400 });
  }
  if (!template?.trim()) {
    return Response.json({ error: 'No template provided.' }, { status: 400 });
  }

  const zip = new JSZip();

  for (const student of rows) {
    const filledSubject = (subject || 'JCC Program Schedule Update').replace(
      /\{\{student_name\}\}/g,
      student.studentName
    );
    const htmlBody = populateTemplate(template, student);
    const eml = buildEml(student, filledSubject, htmlBody);
    const filename = `${toSafeFilename(student.studentName)}.eml`;
    zip.file(filename, eml);
  }

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

  return new Response(zipBuffer.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="jcc-emails.zip"',
    },
  });
}
