// Run with: node generate-mock-data.mjs
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rows = [
  { 'Student Name': 'Emma Cohen',    'Parent Email': 'test+emma@example.com',   'Drop-off Time': '8:00 AM',  'Pick-up Time': '3:30 PM',  'Total Hours': 7.5 },
  { 'Student Name': 'Noah Levy',     'Parent Email': 'test+noah@example.com',    'Drop-off Time': '7:45 AM',  'Pick-up Time': '4:00 PM',  'Total Hours': 8.25 },
  { 'Student Name': 'Mia Shapiro',   'Parent Email': 'test+mia@example.com',     'Drop-off Time': '9:00 AM',  'Pick-up Time': '2:30 PM',  'Total Hours': 5.5 },
  { 'Student Name': 'Liam Stern',    'Parent Email': 'test+liam@example.com',    'Drop-off Time': '8:30 AM',  'Pick-up Time': '5:00 PM',  'Total Hours': 8.5 },
  { 'Student Name': 'Ava Goldberg',  'Parent Email': 'test+ava@example.com',     'Drop-off Time': '7:30 AM',  'Pick-up Time': '3:00 PM',  'Total Hours': 7.5 },
];

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Students');

const outPath = path.join(__dirname, 'sample-data', 'mock-students.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Created:', outPath);
