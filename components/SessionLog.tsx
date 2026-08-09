'use client';

import { useRef } from 'react';
import { Session, exportSessions, importSessions, removeSession } from '@/lib/sessions';
import { headingToCompass } from '@/lib/wind-utils';

function formatWhen(start: number): string {
  const d = new Date(start);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const hhmm = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${hhmm}`;
  return `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${hhmm}`;
}

/**
 * The logged sessions, newest first.
 *
 * Export sits next to the list rather than buried: these are stored in
 * localStorage, which is per-browser and vanishes with "clear site data", and
 * unlike everything else in this app they cannot be re-fetched from anywhere.
 */
export default function SessionLog({
  sessions,
  onChange,
}: {
  sessions: Session[];
  onChange: (sessions: Session[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function download() {
    const blob = new Blob([exportSessions()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `windfoil-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File) {
    const added = importSessions(await file.text());
    if (added === null) {
      alert("That file doesn't look like a session export.");
      return;
    }
    onChange(
      // importSessions has already merged and stored; re-read for the new list.
      JSON.parse(exportSessions()).sessions as Session[]
    );
    alert(added === 0 ? 'Nothing new — those sessions were already logged.' : `Added ${added}.`);
  }

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-xl font-bold text-slate-200">
          Sessions
          {sessions.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500">{sessions.length}</span>
          )}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={download}
            disabled={sessions.length === 0}
            className="text-slate-400 hover:text-slate-200 underline disabled:opacity-40 disabled:no-underline"
          >
            Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-slate-400 hover:text-slate-200 underline"
          >
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="text-slate-500 text-sm">
          No sessions yet. Log one from a spot card with the ⭐ button — within a day of
          riding, while the conditions can still be read.
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-slate-100">{s.spotName}</span>
                  <span className="text-amber-400 text-sm">{'⭐'.repeat(s.rating)}</span>
                  <span className="text-xs text-slate-500">{formatWhen(s.start)}</span>
                </div>
                <div className="text-sm text-slate-300 mt-0.5">
                  {s.conditions.avgWind.toFixed(1)} m/s avg · {s.conditions.maxGust.toFixed(1)} max
                  {s.conditions.dirMean != null && (
                    <> · {headingToCompass(s.conditions.dirMean)}</>
                  )}
                  {s.conditions.waveHeight != null && (
                    <> · {s.conditions.waveHeight.toFixed(1)} m</>
                  )}
                  {s.conditions.source === 'model' && (
                    <span className="text-slate-500 text-xs"> · from model</span>
                  )}
                </div>
                {s.gear && <div className="text-xs text-slate-500 mt-0.5">{s.gear}</div>}
                {s.note && <div className="text-xs text-slate-400 mt-1 italic">{s.note}</div>}
              </div>
              <button
                onClick={() => {
                  if (confirm('Delete this session?')) onChange(removeSession(s.id));
                }}
                aria-label={`Delete session at ${s.spotName}`}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/60 text-slate-500 hover:bg-red-900/80 hover:text-white transition text-sm leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
