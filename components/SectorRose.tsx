import { WindSector, isGoodWindDirection, conditionColors } from '@/lib/wind-utils';

const WEDGE = 45;

/**
 * A small non-interactive compass showing which directions a spot works in,
 * with a tick for where the wind is coming from right now — so the sectors
 * are visible at a glance instead of only inside the editor.
 *
 * Renders nothing without sectors: an empty rose would suggest a spot works
 * in no direction, when it really means we haven't been told.
 */
export default function SectorRose({
  sectors,
  heading,
  size = 20,
}: {
  sectors?: WindSector[];
  heading?: number;
  size?: number;
}) {
  if (!sectors || sectors.length === 0) return null;
  const r = size / 2;
  const inner = r * 0.3;
  const works = heading !== undefined ? isGoodWindDirection(heading, sectors) : null;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => {
        const centre = (i * WEDGE) % 360;
        const on = isGoodWindDirection(centre, sectors);
        const a0 = ((centre - WEDGE / 2 - 90) * Math.PI) / 180;
        const a1 = a0 + (WEDGE * Math.PI) / 180;
        const p = (ang: number, rad: number) =>
          `${(r + Math.cos(ang) * rad).toFixed(2)} ${(r + Math.sin(ang) * rad).toFixed(2)}`;
        return (
          <path
            key={i}
            d={
              `M ${p(a0, inner)} L ${p(a0, r - 0.5)} ` +
              `A ${r - 0.5} ${r - 0.5} 0 0 1 ${p(a1, r - 0.5)} ` +
              `L ${p(a1, inner)} A ${inner} ${inner} 0 0 0 ${p(a0, inner)} Z`
            }
            fill={on ? conditionColors.great : '#334155'}
            fillOpacity={on ? 0.7 : 0.6}
          />
        );
      })}
      {heading !== undefined && (
        // Where the wind is blowing from, so the tick sits on the upwind edge.
        <circle
          cx={r + Math.cos(((heading - 90) * Math.PI) / 180) * (r * 0.72)}
          cy={r + Math.sin(((heading - 90) * Math.PI) / 180) * (r * 0.72)}
          r={size * 0.11}
          fill={works ? '#f1f5f9' : '#94a3b8'}
          stroke="#0f172a"
          strokeWidth={size * 0.05}
        />
      )}
    </svg>
  );
}
