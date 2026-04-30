'use client';

import { ForecastPoint } from '@/lib/smhi';
import {
  getCondition,
  conditionColors,
  conditionLabels,
  ConditionLevel,
  headingToCompass,
} from '@/lib/wind-utils';
import { formatRankingMessage, getAppUrl } from '@/lib/share';
import ShareMenu from './ShareMenu';

// Circular mean of bearings (degrees). Avoids the 350° + 10° = 180° (wrong) trap.
function avgBearing(dirs: number[]): number {
  if (dirs.length === 0) return 0;
  let sumX = 0;
  let sumY = 0;
  for (const d of dirs) {
    sumX += Math.cos((d * Math.PI) / 180);
    sumY += Math.sin((d * Math.PI) / 180);
  }
  const a = (Math.atan2(sumY, sumX) * 180) / Math.PI;
  return (a + 360) % 360;
}

interface StationForecast {
  stationId: string;
  stationName: string;
  forecast: ForecastPoint[];
}

interface GoWindowProps {
  stationForecasts: StationForecast[];
}

interface RankedStation {
  stationName: string;
  start: Date;
  end: Date;
  avgWindSpeed: number;
  peakWindSpeed: number;
  avgWindDir: number;
  condition: ConditionLevel;
  gustRatio: number;
  durationHours: number;
}

function formatWindowTime(d: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dayAfterStart = new Date(todayStart.getTime() + 2 * 86400000);
  const hhmm = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (d >= todayStart && d < tomorrowStart) return `Today ${hhmm}`;
  if (d >= tomorrowStart && d < dayAfterStart) return `Tomorrow ${hhmm}`;
  return d.toLocaleDateString('sv-SE', { weekday: 'short' }) + ` ${hhmm}`;
}

const conditionRank: Record<ConditionLevel, number> = {
  'too-little': 0,
  'ok': 1,
  'great': 2,
  'crazy': 2,
};

function findBestWindowWithin(
  stationName: string,
  forecast: ForecastPoint[],
  hours: number
): RankedStation | null {
  if (forecast.length === 0) return null;
  const now = Date.now();
  const cutoff = now + hours * 3600 * 1000;

  // Trim forecast to the period
  const trimmed = forecast.filter((p) => {
    const t = new Date(p.time).getTime();
    return t >= now && t <= cutoff;
  });
  if (trimmed.length === 0) return null;

  // Find contiguous blocks where condition is OK or better
  const blocks: ForecastPoint[][] = [];
  let current: ForecastPoint[] = [];
  for (const p of trimmed) {
    const c = getCondition(p.windSpeed, p.windDir);
    if (c !== 'too-little') {
      current.push(p);
    } else {
      if (current.length > 0) blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);

  if (blocks.length === 0) return null;

  // Score each block; pick the best
  const scored = blocks
    .filter((b) => b.length >= 2) // at least 2 hourly points = 1h window
    .map((b) => {
      const avgSpeed = b.reduce((s, p) => s + p.windSpeed, 0) / b.length;
      const peakSpeed = Math.max(...b.map((p) => p.windSpeed));
      const avgGust = b.reduce((s, p) => s + p.gust, 0) / b.length;
      const avgDir = avgBearing(b.map((p) => p.windDir));
      const condition = getCondition(avgSpeed, avgDir);
      const gustRatio = avgSpeed > 0 ? avgGust / avgSpeed : 1;
      const start = new Date(b[0].time);
      const end = new Date(b[b.length - 1].time);
      const durationHours = (end.getTime() - start.getTime()) / 3600000;
      const score =
        conditionRank[condition] * 1000 +
        avgSpeed * 30 +
        durationHours * 5 -
        gustRatio * 5;
      return { avgSpeed, peakSpeed, avgDir, condition, gustRatio, start, end, durationHours, score };
    });

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    stationName,
    start: best.start,
    end: best.end,
    avgWindSpeed: best.avgSpeed,
    peakWindSpeed: best.peakSpeed,
    avgWindDir: best.avgDir,
    condition: best.condition,
    gustRatio: best.gustRatio,
    durationHours: best.durationHours,
  };
}

function rank(stationForecasts: StationForecast[], hours: number): RankedStation[] {
  const ranked = stationForecasts
    .map((sf) => findBestWindowWithin(sf.stationName, sf.forecast, hours))
    .filter((r): r is RankedStation => r !== null);
  // Sort by condition rank, then avg wind speed, then duration, then less gustiness
  ranked.sort((a, b) => {
    const cd = conditionRank[b.condition] - conditionRank[a.condition];
    if (cd !== 0) return cd;
    const sd = b.avgWindSpeed - a.avgWindSpeed;
    if (Math.abs(sd) > 0.1) return sd;
    const dd = b.durationHours - a.durationHours;
    if (Math.abs(dd) > 0.1) return dd;
    return a.gustRatio - b.gustRatio;
  });
  return ranked;
}

function RankedList({ title, items }: { title: string; items: RankedStation[] }) {
  const shareMessage = formatRankingMessage(
    title,
    items.map((it) => ({
      stationName: it.stationName,
      start: it.start,
      durationHours: it.durationHours,
      avgWindSpeed: it.avgWindSpeed,
      peakWindSpeed: it.peakWindSpeed,
      avgWindDir: it.avgWindDir,
      condition: it.condition,
    })),
    getAppUrl()
  );
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h3>
        {items.length > 0 && <ShareMenu message={shareMessage} label={`Share ${title}`} />}
      </div>
      {items.length === 0 ? (
        <p className="text-slate-500 text-sm py-3">No good windows in this period.</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it, idx) => (
            <li
              key={`${title}-${it.stationName}-${idx}`}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{
                backgroundColor: conditionColors[it.condition] + '15',
                borderLeft: `3px solid ${conditionColors[it.condition]}`,
              }}
            >
              <span className="text-slate-500 font-mono text-xs w-5 shrink-0">#{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-white truncate">{it.stationName}</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: conditionColors[it.condition] + '40',
                      color: conditionColors[it.condition],
                    }}
                  >
                    {conditionLabels[it.condition]}
                  </span>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-1 flex-wrap">
                  <span>{formatWindowTime(it.start)} ({it.durationHours.toFixed(0)}h)</span>
                  <span className="text-slate-600">·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <svg
                      className="w-3 h-3 text-slate-300 inline-block"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ transform: `rotate(${(it.avgWindDir + 180) % 360}deg)` }}
                    >
                      <path d="M12 2L8 20l4-3 4 3z" />
                    </svg>
                    <span className="text-slate-300">{headingToCompass(it.avgWindDir)}</span>
                    <span className="text-slate-500">{Math.round(it.avgWindDir)}°</span>
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-200 font-medium">{it.avgWindSpeed.toFixed(1)}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-slate-200 font-medium">{it.peakWindSpeed.toFixed(1)}</span>
                  <span className="text-slate-500">m/s</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function GoWindow({ stationForecasts }: GoWindowProps) {
  const next24h = rank(stationForecasts, 24);
  const next48h = rank(stationForecasts, 48);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">🏄</span>
        <h2 className="text-lg font-bold text-slate-100">Spot ranking</h2>
        <span className="text-slate-500 text-xs ml-auto">Best window per station, ranked</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <RankedList title="Next 24h" items={next24h} />
        <div className="hidden sm:block w-px bg-slate-700/60" />
        <RankedList title="Next 48h" items={next48h} />
      </div>
    </div>
  );
}
