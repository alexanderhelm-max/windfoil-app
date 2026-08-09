'use client';

import { useEffect, useState } from 'react';
import { Spot } from '@/lib/spots';
import { WindSector } from '@/lib/wind-utils';
import CompassPicker from './CompassPicker';

/** Per-spot settings: which directions work here, and whether waves apply. */
export default function SpotSettingsDialog({
  spot,
  onSave,
  onClose,
}: {
  spot: Spot;
  onSave: (settings: { goodSectors: WindSector[]; sheltered: boolean }) => void;
  onClose: () => void;
}) {
  const [sectors, setSectors] = useState<WindSector[]>(spot.goodSectors ?? []);
  const [sheltered, setSheltered] = useState<boolean>(spot.sheltered ?? false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">{spot.name} — settings</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs text-slate-400 mb-2">Working wind directions</div>
            <CompassPicker value={sectors} onChange={setSectors} />
          </div>

          <div className="border-t border-slate-700 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sheltered}
                onChange={(e) => setSheltered(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-slate-200">
                Sheltered — don&apos;t show waves
                <span className="block text-xs text-slate-500 mt-0.5">
                  For spots behind islands or inside a harbour. The wave model would
                  answer with the nearest open-sea point, which isn&apos;t the water
                  you launch into.
                </span>
              </span>
            </label>
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
            onClick={() => {
              onSave({ goodSectors: sectors, sheltered });
              onClose();
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-md transition"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
