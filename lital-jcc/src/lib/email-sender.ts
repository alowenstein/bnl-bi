import nodemailer from 'nodemailer';
import { StudentRow } from '@/types/student';

function createTransport() {
  return nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.OUTLOOK_USER,
      pass: process.env.OUTLOOK_PASS,
    },
    tls: {
      ciphers: 'SSLv3',
    },
  });
}

function populateTemplate(template: string, student: StudentRow): string {
  const existingPlan = `Drop-off: ${student.dropOffTime} | Pick-up: ${student.pickUpTime}`;
  return template
    .replace(/\{\{student_name\}\}/g, student.studentName)
    .replace(/\{\{existing_plan\}\}/g, existingPlan)
    .replace(/\{\{total_hours\}\}/g, String(student.totalHours));
}

export async function sendEmail(student: StudentRow, template: string): Promise<void> {
  const transport = createTransport();
  const subject = (process.env.EMAIL_SUBJECT ?? 'JCC Program Schedule Update').replace(
    /\{\{student_name\}\}/g,
    student.studentName
  );

  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.OUTLOOK_USER,
    to: student.parentEmail,
    subject,
    html: populateTemplate(template, student),
  });
}
