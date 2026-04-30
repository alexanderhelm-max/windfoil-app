'use client';

import { ForecastPoint } from '@/lib/smhi';
import { getCondition, conditionColors, conditionLabels, ConditionLevel } from '@/lib/wind-utils';

interface StationForecast {
  stationId: string;
  stationName: string;
  forecast: ForecastPoint[];
}

interface GoWindowProps {
  stationForecasts: StationForecast[];
}

interface GoWindowResult {
  stationName: string;
  start: Date;
  end: Date;
  avgWindSpeed: number;
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

function findBestWindow(_stationId: string, stationName: string, forecast: ForecastPoint[]): GoWindowResult | null {
  if (forecast.length === 0) return null;

  // Find contiguous blocks >= 2h where condition is ok or better
  const blocks: { start: number; end: number; points: ForecastPoint[] }[] = [];
  let currentBlock: ForecastPoint[] | null = null;

  for (const point of forecast) {
    const condition = getCondition(point.windSpeed, point.windDir);
    const isGood = condition === 'ok' || condition === 'great' || condition === 'crazy';

    if (isGood) {
      if (!currentBlock) currentBlock = [];
      currentBlock.push(point);
    } else {
      if (currentBlock && currentBlock.length > 0) {
        const startTime = new Date(currentBlock[0].time).getTime();
        const endTime = new Date(currentBlock[currentBlock.length - 1].time).getTime();
        const durationHours = (endTime - startTime) / 3600000;
        if (durationHours >= 2) {
          blocks.push({ start: startTime, end: endTime, points: currentBlock });
        }
        currentBlock = null;
      }
    }
  }
  // flush last block
  if (currentBlock && currentBlock.length > 0) {
    const startTime = new Date(currentBlock[0].time).getTime();
    const endTime = new Date(currentBlock[currentBlock.length - 1].time).getTime();
    const durationHours = (endTime - startTime) / 3600000;
    if (durationHours >= 2) {
      blocks.push({ start: startTime, end: endTime, points: currentBlock });
    }
  }

  if (blocks.length === 0) return null;

  // Score and rank blocks: prefer great > ok, then longer duration, then lower gust ratio
  const conditionRank: Record<ConditionLevel, number> = {
    'too-little': 0,
    'ok': 1,
    'great': 2,
    'crazy': 2,
  };

  const scored = blocks.map((block) => {
    const avgSpeed = block.points.reduce((s, p) => s + p.windSpeed, 0) / block.points.length;
    const avgGust = block.points.reduce((s, p) => s + p.gust, 0) / block.points.length;
    const avgDir = block.points.reduce((s, p) => s + p.windDir, 0) / block.points.length;
    const condition = getCondition(avgSpeed, avgDir);
    const gustRatio = avgSpeed > 0 ? avgGust / avgSpeed : 1;
    const durationHours = (block.end - block.start) / 3600000;

    const score =
      conditionRank[condition] * 1000 +
      durationHours * 10 -
      gustRatio * 5;

    return { block, avgSpeed, condition, gustRatio, durationHours, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    stationName,
    start: new Date(best.block.start),
    end: new Date(best.block.end),
    avgWindSpeed: best.avgSpeed,
    condition: best.condition,
    gustRatio: best.gustRatio,
    durationHours: best.durationHours,
  };
}

export default function GoWindow({ stationForecasts }: GoWindowProps) {
  const windows: GoWindowResult[] = [];

  for (const sf of stationForecasts) {
    const w = findBestWindow(sf.stationId, sf.stationName, sf.forecast);
    if (w) windows.push(w);
  }

  // Sort all windows: best condition first, then longest duration
  windows.sort((a, b) => {
    const conditionRank: Record<ConditionLevel, number> = {
      'too-little': 0,
      'ok': 1,
      'great': 2,
      'crazy': 2,
    };
    const rankDiff = conditionRank[b.condition] - conditionRank[a.condition];
    if (rankDiff !== 0) return rankDiff;
    return b.durationHours - a.durationHours;
  });

  const bestWindow = windows[0] ?? null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">🏄</span>
        <h2 className="text-lg font-bold text-slate-100">Best Go Window (next 48h)</h2>
      </div>

      {bestWindow ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="flex-1 rounded-lg p-4"
            style={{
              backgroundColor: conditionColors[bestWindow.condition] + '22',
              borderLeft: `4px solid ${conditionColors[bestWindow.condition]}`,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xl text-white">{bestWindow.stationName}</span>
              <span
                className="text-sm font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: conditionColors[bestWindow.condition] + '44',
                  color: conditionColors[bestWindow.condition],
                }}
              >
                {conditionLabels[bestWindow.condition]}
              </span>
            </div>

            <div className="text-slate-300 text-sm mb-1">
              <span className="font-medium">{formatWindowTime(bestWindow.start)}</span>
              {' '}–{' '}
              <span className="font-medium">{formatWindowTime(bestWindow.end)}</span>
              <span className="text-slate-500 ml-2">
                ({bestWindow.durationHours.toFixed(0)}h)
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-300">
                ~{bestWindow.avgWindSpeed.toFixed(1)} m/s avg
              </span>
              <span className="text-slate-500">|</span>
              <span
                className={
                  bestWindow.gustRatio < 1.3
                    ? 'text-green-400'
                    : bestWindow.gustRatio < 1.5
                    ? 'text-yellow-400'
                    : 'text-orange-400'
                }
              >
                {bestWindow.gustRatio < 1.3
                  ? 'Smooth'
                  : bestWindow.gustRatio < 1.5
                  ? 'Moderate gusts'
                  : 'Gusty'}{' '}
                ({bestWindow.gustRatio.toFixed(2)}×)
              </span>
            </div>
          </div>

          {/* Other windows */}
          {windows.length > 1 && (
            <div className="flex-shrink-0">
              <p className="text-slate-500 text-xs mb-2">Other windows:</p>
              <div className="flex flex-col gap-1">
                {windows.slice(1, 4).map((w, i) => (
                  <div key={i} className="text-sm text-slate-400">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                      style={{ backgroundColor: conditionColors[w.condition] }}
                    />
                    {w.stationName}: {formatWindowTime(w.start)} ({w.durationHours.toFixed(0)}h)
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-slate-400 py-2">
          No ideal window in next 48h. Check back later or consider lower-wind activity.
        </div>
      )}
    </div>
  );
}
