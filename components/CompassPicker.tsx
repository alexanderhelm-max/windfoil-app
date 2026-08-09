'use client';

import { useMemo } from 'react';
import { WindSector } from '@/lib/wind-utils';

/** Eight 45° wedges, centred on the compass points. N spans 337.5°–22.5°. */
const WEDGE = 45;
const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Wedge i covers [i*45 - 22.5, i*45 + 22.5). */
function wedgeStart(i: number): number {
  return (i * WEDGE - WEDGE / 2 + 360) % 360;
}

function sectorsToWedges(sectors?: WindSector[]): boolean[] {
  const on = Array(8).fill(false);
  if (!sectors) return on;
  for (let i = 0; i < 8; i++) {
    // A wedge counts as selected when its centre falls inside a sector.
    const centre = (i * WEDGE) % 360;
    for (const { from, to } of sectors) {
      const inside = from <= to ? centre >= from && centre <= to : centre >= from || centre <= to;
      if (inside) on[i] = true;
    }
  }
  return on;
}

/**
 * Merge selected wedges into as few sectors as possible, joining runs that
 * wrap past north so NW–N–NE becomes one sector rather than two.
 */
function wedgesToSectors(on: boolean[]): WindSector[] {
  if (on.every(Boolean)) return [{ from: 0, to: 359 }];
  if (!on.some(Boolean)) return [];
  const sectors: WindSector[] = [];
  let i = 0;
  // Start from a wedge whose predecessor is off, so no run is split in two.
  while (i < 8 && !(on[i] && !on[(i + 7) % 8])) i++;
  const start = i === 8 ? 0 : i;
  let seen = 0;
  let cur = start;
  while (seen < 8) {
    if (on[cur]) {
      const from = wedgeStart(cur);
      let len = 0;
      while (on[(cur + len) % 8] && len < 8) len++;
      const to = (wedgeStart((cur + len - 1) % 8) + WEDGE - 1 + 360) % 360;
      sectors.push({ from, to });
      cur = (cur + len) % 8;
      seen += len;
    } else {
      cur = (cur + 1) % 8;
      seen++;
    }
  }
  return sectors;
}

/**
 * Pick the compass sectors a spot works in. Selecting nothing means "unknown",
 * and the spot is then graded on wind speed alone.
 */
export default function CompassPicker({
  value,
  onChange,
  size = 168,
}: {
  value?: WindSector[];
  onChange: (sectors: WindSector[]) => void;
  size?: number;
}) {
  const wedges = useMemo(() => sectorsToWedges(value), [value]);
  const r = size / 2;
  const inner = r * 0.34;

  function toggle(i: number) {
    const next = [...wedges];
    next[i] = !next[i];
    onChange(wedgesToSectors(next));
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {wedges.map((on, i) => {
          const a0 = ((wedgeStart(i) - 90) * Math.PI) / 180;
          const a1 = a0 + (WEDGE * Math.PI) / 180;
          const p = (ang: number, rad: number) =>
            `${(r + Math.cos(ang) * rad).toFixed(2)} ${(r + Math.sin(ang) * rad).toFixed(2)}`;
          const d =
            `M ${p(a0, inner)} L ${p(a0, r - 2)} ` +
            `A ${r - 2} ${r - 2} 0 0 1 ${p(a1, r - 2)} ` +
            `L ${p(a1, inner)} A ${inner} ${inner} 0 0 0 ${p(a0, inner)} Z`;
          const mid = (a0 + a1) / 2;
          const lx = r + Math.cos(mid) * (r * 0.72);
          const ly = r + Math.sin(mid) * (r * 0.72);
          return (
            <g key={i} onClick={() => toggle(i)} style={{ cursor: 'pointer' }}>
              <path
                d={d}
                fill={on ? '#22c55e' : '#1e293b'}
                fillOpacity={on ? 0.55 : 1}
                stroke={on ? '#22c55e' : '#334155'}
                strokeWidth={1.5}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={600}
                fill={on ? '#dcfce7' : '#64748b'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {LABELS[i]}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="text-xs text-slate-400 max-w-[16rem]">
        <p className="mb-2">
          Tap the directions the wind can blow <strong className="text-slate-200">from</strong> for
          this spot to work.
        </p>
        <p className="mb-2 text-slate-500">
          Wind from any other direction needs 1 m/s more to reach each level.
        </p>
        {wedges.some(Boolean) ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-slate-400 hover:text-slate-200 underline"
          >
            Clear — grade on speed only
          </button>
        ) : (
          <p className="text-slate-500 italic">
            Nothing selected: graded on wind speed alone.
          </p>
        )}
      </div>
    </div>
  );
}
