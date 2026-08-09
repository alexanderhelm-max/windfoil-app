'use client';

import { useEffect, useState } from 'react';
import { Spot } from '@/lib/spots';
import { WindSector } from '@/lib/wind-utils';
import CompassPicker from './CompassPicker';

/** Edit which wind directions an existing spot works in. */
export default function EditSectorsDialog({
  spot,
  onSave,
  onClose,
}: {
  spot: Spot;
  onSave: (sectors: WindSector[]) => void;
  onClose: () => void;
}) {
  const [sectors, setSectors] = useState<WindSector[]>(spot.goodSectors ?? []);

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
          <h2 className="text-lg font-semibold text-white">
            Wind directions — {spot.name}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          <CompassPicker value={sectors} onChange={setSectors} />
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
              onSave(sectors);
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
