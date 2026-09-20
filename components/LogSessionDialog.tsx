'use client';

import { useEffect, useMemo, useState } from 'react';
import { Spot } from '@/lib/spots';
import { SmhiObsHistory } from '@/lib/smhi';
import { MarineNow } from '@/lib/marine';
import { Session, summariseConditions } from '@/lib/sessions';
import { headingToCompass } from '@/lib/wind-utils';

const DURATIONS = [1, 2, 3, 4] as const;
/** Observation history reaches 24 h back; a window starting earlier has nothing. */
const HISTORY_HOURS = 24;
/** Half-hour steps: you rarely know the minute, but "an hour and a half ago" is
 *  a real answer, and at a 1–2 h session it changes which readings get included. */
const AGO_STEP_H = 0.5;

function formatAgo(h: number): string {
  if (h === 0) return 'just now';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (whole === 0) return `${mins} min ago`;
  return mins === 0 ? `${whole}h ago` : `${whole}h ${mins}m ago`;
}

/**
 * Log a session just ridden.
 *
 * The conditions it will store are shown before saving, because they're a
 * snapshot that can't be recomputed later — if the window is wrong, it has to
 * be fixed now. Observation history only reaches 24 hours back, so the form
 * asks how long ago you finished rather than offering a free date picker, and
 * the slider simply stops where the history does — a window that can't be
 * filled is unreachable rather than offered and then refused.
 */
export default function LogSessionDialog({
  spot,
  history,
  marine,
  historyIsModelled,
  stationName,
  onSave,
  onClose,
}: {
  spot: Spot;
  history: SmhiObsHistory | null;
  marine?: MarineNow | null;
  historyIsModelled?: boolean;
  stationName?: string;
  onSave: (session: Session) => void;
  onClose: () => void;
}) {
  const [hours, setHours] = useState<number>(2);
  const [endedAgo, setEndedAgo] = useState<number>(0);

  // The far end of the slider is wherever this session length runs out of
  // history, so it moves as the duration changes.
  const maxAgo = HISTORY_HOURS - hours;
  // Lengthening a session can push an already-old window off the back of the
  // history, so pull it forward rather than leaving an unsavable selection.
  function chooseDuration(h: number) {
    setHours(h);
    setEndedAgo((a) => Math.min(a, HISTORY_HOURS - h));
  }
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(4);
  const [note, setNote] = useState('');
  const [gear, setGear] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { start, end } = useMemo(() => {
    const e = Date.now() - endedAgo * 3600_000;
    return { start: e - hours * 3600_000, end: e };
  }, [hours, endedAgo]);

  const conditions = useMemo(
    () =>
      summariseConditions(history, start, end, {
        source: historyIsModelled ? 'model' : 'measured',
        stationName,
        marine,
      }),
    [history, start, end, historyIsModelled, stationName, marine]
  );

  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  function save() {
    if (!conditions) return;
    onSave({
      id: `${spot.id}-${start}`,
      spotId: spot.id,
      spotName: spot.name,
      start,
      end,
      rating,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(gear.trim() ? { gear: gear.trim() } : {}),
      conditions,
      createdAt: Date.now(),
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Log session — {spot.name}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">How long were you out?</label>
            <div className="flex gap-1.5 flex-wrap">
              {DURATIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => chooseDuration(h)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    hours === h
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="ended-ago" className="text-xs text-slate-400">
                Finished
              </label>
              <span className="text-sm font-medium text-white tabular-nums">
                {formatAgo(endedAgo)}
              </span>
            </div>
            <input
              id="ended-ago"
              type="range"
              min={0}
              max={maxAgo}
              step={AGO_STEP_H}
              value={endedAgo}
              onChange={(e) => setEndedAgo(Number(e.target.value))}
              aria-valuetext={formatAgo(endedAgo)}
              // The fill is painted as a gradient rather than left to
              // accent-color, which only tints the default light track — far
              // too bright against the rest of this dialog.
              style={{
                background: `linear-gradient(to right, #3b82f6 ${(endedAgo / maxAgo) * 100}%, #0f172a ${(endedAgo / maxAgo) * 100}%)`,
              }}
              className="w-full h-1.5 appearance-none rounded-full border border-slate-700 cursor-pointer
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:border-0
                [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>now</span>
              <span>{maxAgo}h ago</span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
              {fmt(start)} – {fmt(end)} · history reaches {HISTORY_HOURS}h back, so a{' '}
              {hours}h session stops at {maxAgo}h ago
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">How was it?</label>
            <div className="flex gap-1">
              {([1, 2, 3, 4, 5] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRating(r)}
                  aria-label={`${r} of 5`}
                  className={`text-2xl leading-none transition ${
                    r <= rating ? 'opacity-100' : 'opacity-25 hover:opacity-60'
                  }`}
                >
                  ⭐
                </button>
              ))}
            </div>
          </div>

          {/* Shown before saving because it's a snapshot: once the day rolls
              over there's no history left to recompute it from. */}
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-3">
            <div className="text-xs text-slate-400 mb-1.5">Conditions that will be saved</div>
            {conditions ? (
              <>
                <div className="text-sm text-slate-200">
                  <span className="font-semibold">{conditions.avgWind.toFixed(1)}</span> m/s avg ·{' '}
                  <span className="font-semibold">{conditions.maxGust.toFixed(1)}</span> max
                  {conditions.dirMean != null && (
                    <>
                      {' '}
                      · {headingToCompass(conditions.dirMean)} {Math.round(conditions.dirMean)}°
                    </>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {conditions.source === 'measured'
                    ? `measured${conditions.stationName ? ` at ${conditions.stationName}` : ''}`
                    : 'from model — no measured data for this window'}{' '}
                  · {conditions.sampleCount} readings
                  {conditions.waveHeight != null &&
                    ` · ${conditions.waveHeight.toFixed(1)} m waves`}
                </div>
              </>
            ) : (
              <div className="text-sm text-amber-300">
                No wind readings for that window — pick a different time, or log it without
                waiting until tomorrow. History only reaches 24 hours back.
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Gear (optional)</label>
            <input
              type="text"
              value={gear}
              onChange={(e) => setGear(e.target.value)}
              placeholder="e.g. 5 m wing, 1100 front"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white placeholder-slate-600 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Choppy inside, cleaner past the point…"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white placeholder-slate-600 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-slate-700">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-slate-300 hover:text-white text-sm rounded-md transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!conditions}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-medium text-sm rounded-md transition"
          >
            Save session
          </button>
        </div>
      </div>
    </div>
  );
}
