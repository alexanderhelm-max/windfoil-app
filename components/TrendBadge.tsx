import { TrendDirection, trendIcons } from '@/lib/wind-utils';

export interface Trend {
  direction: TrendDirection;
  ratePerHour: number;
}

const trendColors: Record<TrendDirection, string> = {
  building: 'text-green-400',
  dropping: 'text-orange-400',
  steady: 'text-slate-400',
};

/**
 * Last-hour wind trend. Renders nothing when the trend is null — too little
 * data to read one — so callers can pass it through unguarded.
 *
 * `compact` drops the "1h" suffix for dense rows where a heading already
 * establishes that everything shown is current.
 */
export default function TrendBadge({
  trend,
  compact = false,
}: {
  trend: Trend | null;
  compact?: boolean;
}) {
  if (!trend) return null;
  return (
    <span
      className={`font-semibold ${trendColors[trend.direction]}`}
      title={`Last hour: ${trend.direction} (${trend.ratePerHour.toFixed(1)} m/s per hour)`}
    >
      {trendIcons[trend.direction]}
      {trend.direction !== 'steady' && (
        <span className="ml-0.5 tabular-nums">
          {trend.ratePerHour > 0 ? '+' : ''}
          {trend.ratePerHour.toFixed(1)}/h
        </span>
      )}
      {!compact && <span className="ml-1 text-[10px] font-normal text-slate-500">1h</span>}
    </span>
  );
}
