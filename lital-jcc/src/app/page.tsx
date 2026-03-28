'use client';

import { useState, useRef, useCallback } from 'react';
import { StudentRow, SendResult } from '@/types/student';

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
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

type AppState = 'idle' | 'parsing' | 'ready' | 'sending' | 'done';

export default function Home() {
  const [state, setState] = useState<AppState>('idle');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [results, setResults] = useState<SendResult[]>([]);
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))));
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-[#1a5276] text-white px-8 py-5 shadow">
        <h1 className="text-xl font-semibold tracking-tight">JCC Email Sender</h1>
        <p className="text-sm text-blue-200 mt-0.5">Upload an Excel file and send personalized emails to parents</p>
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
              {state === 'parsing' ? 'Parsing…' : 'Click to upload .xlsx file'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Required columns: Student Name, Parent Email, Drop-off Time, Pick-up Time, Total Hours</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          {parseError && <p className="mt-3 text-sm text-red-600">{parseError}</p>}
        </section>

        {/* Step 2: Preview Table */}
        {rows.length > 0 && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-800">2. Preview & Select Recipients</h2>
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
                    <th className="pb-2">Status</th>
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
                        <td className="py-2">
                          {result ? (
                            result.status === 'sent' ? (
                              <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ Sent</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs font-medium" title={result.error}>✗ Error</span>
                            )
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Step 3: Template Editor */}
        {rows.length > 0 && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1">3. Email Template</h2>
            <p className="text-xs text-slate-500 mb-3">
              Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{student_name}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{existing_plan}}'}</code>{' '}
              <code className="bg-slate-100 px-1 rounded">{'{{total_hours}}'}</code>
            </p>
            <textarea
              className="w-full h-64 font-mono text-xs border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[#1a5276] resize-y"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              spellCheck={false}
            />
          </section>
        )}

        {/* Step 4: Send */}
        {rows.length > 0 && (
          <section className="flex items-center gap-4">
            <button
              onClick={handleSend}
              disabled={state === 'sending' || selected.size === 0}
              className="bg-[#1a5276] hover:bg-[#154360] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              {state === 'sending'
                ? 'Sending…'
                : `Send ${selected.size} Email${selected.size !== 1 ? 's' : ''}`}
            </button>
            {state === 'done' && (
              <p className="text-sm text-slate-600">
                {results.filter((r) => r.status === 'sent').length} sent,{' '}
                {results.filter((r) => r.status === 'error').length} failed
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
