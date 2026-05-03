'use client';

import { ForecastPoint } from '@/lib/smhi';
import { VivaObservation } from '@/lib/viva';
import {
  getCondition,
  conditionColors,
  conditionLabels,
  ConditionLevel,
  headingToCompass,
  bearingDiff,
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
  current: VivaObservation | null;
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
  startWindDir: number;
  endWindDir: number;
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

function findBestWindowInRange(
  stationName: string,
  forecast: ForecastPoint[],
  startHours: number,
  endHours: number
): RankedStation | null {
  if (forecast.length === 0) return null;
  const now = Date.now();
  const start = now + startHours * 3600 * 1000;
  const end = now + endHours * 3600 * 1000;

  // Trim forecast to the period
  const trimmed = forecast.filter((p) => {
    const t = new Date(p.time).getTime();
    return t >= start && t <= end;
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
      const startDir = b[0].windDir;
      const endDir = b[b.length - 1].windDir;
      const condition = getCondition(avgSpeed, avgDir);
      const gustRatio = avgSpeed > 0 ? avgGust / avgSpeed : 1;
      const startTime = new Date(b[0].time);
      const endTime = new Date(b[b.length - 1].time);
      const durationHours = (endTime.getTime() - startTime.getTime()) / 3600000;
      const score =
        conditionRank[condition] * 1000 +
        avgSpeed * 30 +
        durationHours * 5 -
        gustRatio * 5;
      return {
        avgSpeed,
        peakSpeed,
        avgDir,
        startDir,
        endDir,
        condition,
        gustRatio,
        start: startTime,
        end: endTime,
        durationHours,
        score,
      };
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
    startWindDir: best.startDir,
    endWindDir: best.endDir,
    condition: best.condition,
    gustRatio: best.gustRatio,
    durationHours: best.durationHours,
  };
}

function rank(stationForecasts: StationForecast[], startHours: number, endHours: number): RankedStation[] {
  const ranked = stationForecasts
    .map((sf) => findBestWindowInRange(sf.stationName, sf.forecast, startHours, endHours))
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

/**
 * Rank stations by their CURRENT measured (or nowcast) conditions.
 * durationHours is set to 0 to signal "right now" in the UI.
 */
function rankNow(stationForecasts: StationForecast[]): RankedStation[] {
  const now = new Date();
  const ranked: RankedStation[] = stationForecasts
    .filter((sf) => sf.current !== null)
    .map((sf) => {
      const c = sf.current!;
      const condition = getCondition(c.avgWind, c.heading);
      const gustRatio = c.avgWind > 0 ? c.gust / c.avgWind : 1;
      return {
        stationName: sf.stationName,
        start: now,
        end: now,
        avgWindSpeed: c.avgWind,
        peakWindSpeed: c.gust,
        avgWindDir: c.heading,
        startWindDir: c.heading,
        endWindDir: c.heading,
        condition,
        gustRatio,
        durationHours: 0,
      };
    })
    .filter((s) => s.condition !== 'too-little');

  ranked.sort((a, b) => {
    const cd = conditionRank[b.condition] - conditionRank[a.condition];
    if (cd !== 0) return cd;
    const sd = b.avgWindSpeed - a.avgWindSpeed;
    if (Math.abs(sd) > 0.1) return sd;
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
                  <span>
                    {it.durationHours === 0
                      ? 'Right now'
                      : `${formatWindowTime(it.start)} (${it.durationHours.toFixed(0)}h)`}
                  </span>
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
                    {bearingDiff(it.startWindDir, it.endWindDir) > 45 && (
                      <span
                        className="ml-1 text-amber-400"
                        title={`Wind shifts from ${headingToCompass(it.startWindDir)} to ${headingToCompass(it.endWindDir)} during this window`}
                      >
                        ↻ {headingToCompass(it.startWindDir)}→{headingToCompass(it.endWindDir)}
                      </span>
                    )}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-200 font-medium">{it.avgWindSpeed.toFixed(1)}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-slate-200 font-medium">{it.peakWindSpeed.toFixed(1)}</span>
                  <span className="text-slate-500">
                    m/s {it.durationHours === 0 ? 'avg/gust' : 'avg/peak'}
                  </span>
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
  const now = rankNow(stationForecasts);
  const next6h = rank(stationForecasts, 0, 6);
  const next24h = rank(stationForecasts, 0, 24);
  const next48h = rank(stationForecasts, 0, 48);
  const day3to4 = rank(stationForecasts, 48, 96);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">🏄</span>
        <h2 className="text-lg font-bold text-slate-100">Spot ranking</h2>
        <span className="text-slate-500 text-xs ml-auto hidden sm:block">
          Best spots per time horizon
        </span>
      </div>

      {/* Row 1 — Go now? Decide in the next few hours */}
      <div className="mb-1">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Go now?</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <RankedList title="Right now" items={now} />
          <RankedList title="Next 6h" items={next6h} />
        </div>
      </div>

      {/* Row 2 — Plan for today / tomorrow */}
      <div className="mt-5 pt-4 border-t border-slate-700/50">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Plan ahead</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <RankedList title="Next 24h" items={next24h} />
          <RankedList title="Next 48h" items={next48h} />
        </div>
      </div>

      {/* Row 3 — Worth waiting? Beyond 48h */}
      {day3to4.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Worth waiting?</p>
          <RankedList title="Day 3–4" items={day3to4.slice(0, 3)} />
        </div>
      )}
    </div>
  );
}
