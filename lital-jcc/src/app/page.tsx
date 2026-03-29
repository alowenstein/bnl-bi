'use client';

import { useState, useRef, useCallback } from 'react';
import { StudentRow, SendResult } from '@/types/student';

const DEFAULT_SUBJECT = 'JCC Program Schedule Update for {{student_name}}';

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; padding: 16px; }
    .plan-box { background: #eaf4fb; border-left: 4px solid #1a5276; padding: 14px 18px; border-radius: 4px; margin: 20px 0; }
  </style>
</head>
<body>
  <p>Dear Parent/Guardian,</p>
  <p>We are reaching out regarding <strong>{{student_name}}</strong>'s enrollment in our JCC program.</p>
  <div class="plan-box">
    <p><strong>Current Plan</strong></p>
    <p>{{existing_plan}}</p>
    <p><strong>Total Hours:</strong> {{total_hours}}</p>
  </div>
  <p>Please don't hesitate to contact us if you have any questions.</p>
  <p>Warm regards,<br /><strong>The JCC Team</strong></p>
</body>
</html>`;

const PLACEHOLDERS = [
  { label: '{{student_name}}', title: 'Student name' },
  { label: '{{existing_plan}}', title: 'Drop-off & pick-up times' },
  { label: '{{total_hours}}', title: 'Total hours' },
];

function populateTemplate(template: string, student: StudentRow): string {
  const existingPlan = `Drop-off: ${student.dropOffTime} | Pick-up: ${student.pickUpTime}`;
  return template
    .replace(/\{\{student_name\}\}/g, student.studentName)
    .replace(/\{\{existing_plan\}\}/g, existingPlan)
    .replace(/\{\{total_hours\}\}/g, String(student.totalHours));
}

type AppState = 'idle' | 'parsing' | 'ready' | 'sending' | 'done';

export default function Home() {
  const [state, setState] = useState<AppState>('idle');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [results, setResults] = useState<SendResult[]>([]);
  const [parseError, setParseError] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setState('parsing');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/parse-excel', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      setParseError(data.error ?? 'Failed to parse file.');
      setState('idle');
      return;
    }
    setRows(data.rows);
    setSelected(new Set(data.rows.map((_: StudentRow, i: number) => i)));
    setResults([]);
    setState('ready');
  }, []);

  const toggleRow = (i: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const toggleAll = () =>
    setSelected((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)));

  const insertPlaceholder = (placeholder: string) => {
    const ta = templateRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = template.slice(0, start) + placeholder + template.slice(end);
    setTemplate(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + placeholder.length, start + placeholder.length);
    }, 0);
  };

  const handleDownload = async () => {
    const selectedRows = rows.filter((_, i) => selected.has(i));
    if (selectedRows.length === 0) return;
    setDownloading(true);
    const res = await fetch('/api/download-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: selectedRows, template, subject }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jcc-emails.zip';
      a.click();
      URL.revokeObjectURL(url);
    }
    setDownloading(false);
  };

  const handleSend = async () => {
    const selectedRows = rows.filter((_, i) => selected.has(i));
    if (selectedRows.length === 0) return;
    setState('sending');
    const res = await fetch('/api/send-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: selectedRows, template }),
    });
    const data = await res.json();
    setResults(data.results ?? []);
    setState('done');
  };

  const resultMap = new Map(results.map((r) => [r.email + r.studentName, r]));
  const previewStudent = previewIndex !== null ? rows[previewIndex] : null;
  const selectedRows = rows.filter((_, i) => selected.has(i));

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="bg-[#1a5276] text-white px-8 py-5 shadow">
        <h1 className="text-xl font-semibold tracking-tight">JCC Email Sender</h1>
        <p className="text-sm text-blue-200 mt-0.5">Upload an Excel file, compose your template, and download ready-to-send emails</p>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">

        {/* Step 1: Upload */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">1. Upload Excel File</h2>
          <div
            className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#1a5276] transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="mx-auto mb-3 text-slate-400" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-slate-600 text-sm">
              {state === 'parsing' ? 'Parsing…' : rows.length > 0 ? `✓ ${rows.length} students loaded — click to replace` : 'Click to upload .xlsx file'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Columns: Student Name · Parent Email · Drop-off Time · Pick-up Time · Total Hours</p>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          {parseError && <p className="mt-3 text-sm text-red-600">{parseError}</p>}
        </section>

        {/* Step 2: Template */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">2. Email Template</h2>

          {/* Subject */}
          <label className="block text-xs font-medium text-slate-600 mb-1">Subject line</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#1a5276]"
          />

          {/* Placeholder buttons */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs text-slate-500">Insert placeholder:</span>
            {PLACEHOLDERS.map(({ label, title }) => (
              <button
                key={label}
                title={title}
                onClick={() => insertPlaceholder(label)}
                className="text-xs bg-slate-100 hover:bg-[#eaf4fb] hover:text-[#1a5276] border border-slate-200 rounded px-2 py-1 font-mono transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Template textarea */}
          <textarea
            ref={templateRef}
            className="w-full h-72 font-mono text-xs border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[#1a5276] resize-y"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            spellCheck={false}
          />
        </section>

        {/* Step 3: Students */}
        {rows.length > 0 && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-800">3. Students</h2>
              <span className="text-sm text-slate-500">{selected.size} of {rows.length} selected</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="pb-2 pr-4">
                      <input type="checkbox" checked={selected.size === rows.length} onChange={toggleAll} className="cursor-pointer" />
                    </th>
                    <th className="pb-2 pr-4">Student</th>
                    <th className="pb-2 pr-4">Parent Email</th>
                    <th className="pb-2 pr-4">Drop-off</th>
                    <th className="pb-2 pr-4">Pick-up</th>
                    <th className="pb-2 pr-4">Hours</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const result = resultMap.get(row.parentEmail + row.studentName);
                    return (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 pr-4">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} className="cursor-pointer" />
                        </td>
                        <td className="py-2 pr-4 font-medium text-slate-800">{row.studentName}</td>
                        <td className="py-2 pr-4 text-slate-600">{row.parentEmail}</td>
                        <td className="py-2 pr-4 text-slate-600">{row.dropOffTime}</td>
                        <td className="py-2 pr-4 text-slate-600">{row.pickUpTime}</td>
                        <td className="py-2 pr-4 text-slate-600">{row.totalHours}</td>
                        <td className="py-2 pr-4">
                          {result ? (
                            result.status === 'sent'
                              ? <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ Sent</span>
                              : <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs font-medium" title={result.error}>✗ Error</span>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="py-2">
                          <button onClick={() => setPreviewIndex(i)} className="text-xs text-[#1a5276] hover:underline font-medium">
                            Preview
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Step 4: Actions */}
        {rows.length > 0 && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">4. Send or Download</h2>
            <div className="flex flex-wrap items-center gap-3">

              {/* Download .eml zip */}
              <button
                onClick={handleDownload}
                disabled={downloading || selected.size === 0}
                className="flex items-center gap-2 bg-[#1a5276] hover:bg-[#154360] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                </svg>
                {downloading ? 'Generating…' : `Download ${selected.size} .eml file${selected.size !== 1 ? 's' : ''}`}
              </button>

              <span className="text-slate-300 text-sm">or</span>

              {/* Send via SMTP */}
              <button
                onClick={handleSend}
                disabled={state === 'sending' || selected.size === 0}
                className="flex items-center gap-2 border border-slate-300 hover:border-slate-400 text-slate-700 font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {state === 'sending' ? 'Sending…' : `Send via Outlook SMTP`}
              </button>

            </div>

            <p className="mt-3 text-xs text-slate-400">
              <strong>Download:</strong> saves a .zip of .eml files — double-click any to open in Outlook and send.
              &nbsp;·&nbsp;
              <strong>SMTP:</strong> requires Outlook credentials in <code>.env.local</code>.
            </p>

            {state === 'done' && (
              <p className="mt-2 text-sm text-slate-600">
                {results.filter((r) => r.status === 'sent').length} sent · {results.filter((r) => r.status === 'error').length} failed
              </p>
            )}
          </section>
        )}

      </main>

      {/* Email Preview Modal */}
      {previewStudent !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setPreviewIndex(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <p className="font-semibold text-slate-800">Email Preview</p>
                <p className="text-xs text-slate-500 mt-0.5">To: {previewStudent.parentEmail} · {previewStudent.studentName}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setPreviewIndex((i) => Math.max(0, (i ?? 0) - 1))} disabled={previewIndex === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-sm">← Prev</button>
                <span className="text-xs text-slate-400">{(previewIndex ?? 0) + 1} / {rows.length}</span>
                <button onClick={() => setPreviewIndex((i) => Math.min(rows.length - 1, (i ?? 0) + 1))} disabled={previewIndex === rows.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-sm">Next →</button>
                <button onClick={() => setPreviewIndex(null)} className="ml-2 text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              </div>
            </div>
            <div className="px-6 py-2 bg-slate-50 border-b border-slate-100">
              <p className="text-xs text-slate-500">
                <span className="font-medium">Subject:</span>{' '}
                {subject.replace(/\{\{student_name\}\}/g, previewStudent.studentName)}
              </p>
            </div>
            <div className="flex-1 overflow-auto">
              <iframe
                srcDoc={populateTemplate(template, previewStudent)}
                className="w-full min-h-[480px] border-0"
                title={`Email preview for ${previewStudent.studentName}`}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
