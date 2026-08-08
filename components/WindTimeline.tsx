'use client';

import { useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { SmhiObsHistory, ForecastPoint } from '@/lib/smhi';

interface WindTimelineProps {
  stationName: string;
  history: SmhiObsHistory | null;
  forecast: ForecastPoint[];
  /** True when history came from Open-Meteo model rather than measured SMHI obs */
  historyIsModelled?: boolean;
}

interface ChartDataPoint {
  time: number; // epoch ms
  label: string;
  obsAvg?: number;
  obsGust?: number;
  fctAvg?: number;
  fctGust?: number;
}

type RangeKey = 'now' | 'today' | 'ahead';
const RANGES: Record<RangeKey, { label: string; pastH: number; futureH: number }> = {
  now: { label: 'Now', pastH: 2, futureH: 4 },
  today: { label: 'Today', pastH: 4, futureH: 12 },
  ahead: { label: 'Ahead', pastH: 0, futureH: 96 },
};

function formatAxisTime(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${dayNames[d.getDay()]} ${hh}:${mm}`;
}

function formatTooltipTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString('sv-SE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WindTimeline({
  stationName,
  history,
  forecast,
  historyIsModelled = false,
}: WindTimelineProps) {
  const [range, setRange] = useState<RangeKey>('today');
  const nowEpoch = Date.now();
  const windowStart = nowEpoch - RANGES[range].pastH * 3600 * 1000;
  const windowEnd = nowEpoch + RANGES[range].futureH * 3600 * 1000;

  // Build merged dataset
  const dataMap = new Map<number, ChartDataPoint>();

  // Add observed data points
  if (history) {
    const obsSpeedMap = new Map<number, number>();
    for (const p of history.windSpeed) {
      obsSpeedMap.set(p.time, p.value);
    }
    const obsGustMap = new Map<number, number>();
    for (const p of history.gust) {
      obsGustMap.set(p.time, p.value);
    }

    // Use windSpeed times as anchor
    for (const p of history.windSpeed) {
      const existing = dataMap.get(p.time) ?? { time: p.time, label: formatAxisTime(p.time) };
      existing.obsAvg = obsSpeedMap.get(p.time);
      existing.obsGust = obsGustMap.get(p.time);
      dataMap.set(p.time, existing);
    }
  }

  // Add forecast data points
  for (const f of forecast) {
    const t = new Date(f.time).getTime();
    const existing = dataMap.get(t) ?? { time: t, label: formatAxisTime(t) };
    existing.fctAvg = f.windSpeed;
    existing.fctGust = f.gust;
    dataMap.set(t, existing);
  }

  const allData = Array.from(dataMap.values()).sort((a, b) => a.time - b.time);
  // Keep one point of "padding" on each side so lines don't get clipped to a stub
  // just inside the window edge.
  const chartData = allData.filter((p) => p.time >= windowStart && p.time <= windowEnd);

  // Bridge: stamp the last observed values onto the last obs point as forecast
  // values so the forecast line reaches (and continues past) the live "now"
  // anchor. Only mirror into the reverse direction — obs onto the first
  // forecast point — when the forecast comes strictly AFTER all obs; when a
  // NOW-anchor sits between two hourly forecast buckets, doing the reverse
  // would paint a phantom "measured" value that's actually just forecast.
  const lastObsIdx = chartData.reduce((best, p, i) => (p.obsAvg !== undefined ? i : best), -1);
  const firstFctIdx = chartData.findIndex((p) => p.fctAvg !== undefined);
  if (lastObsIdx >= 0 && firstFctIdx >= 0) {
    chartData[lastObsIdx].fctAvg = chartData[lastObsIdx].obsAvg;
    chartData[lastObsIdx].fctGust = chartData[lastObsIdx].obsGust;
    if (firstFctIdx > lastObsIdx) {
      chartData[firstFctIdx].obsAvg = chartData[firstFctIdx].fctAvg;
      chartData[firstFctIdx].obsGust = chartData[firstFctIdx].fctGust;
    }
  }

  interface TooltipPayloadEntry {
    name?: string;
    value?: number;
    color?: string;
  }
  interface TooltipPropsLoose {
    active?: boolean;
    payload?: TooltipPayloadEntry[];
    label?: string | number;
  }
  const customTooltip = (props: TooltipPropsLoose) => {
    const { active, payload, label } = props;
    if (!active || !payload || payload.length === 0) return null;
    const labelNum = typeof label === 'number' ? label : Number(label);
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-300 mb-2 font-medium">
          {!isNaN(labelNum) ? formatTooltipTime(labelNum) : ''}
        </p>
        {payload.map((entry, i) => (
          <div key={entry.name ?? i} className="flex items-center gap-2">
            <span style={{ color: entry.color ?? '#94a3b8' }}>{entry.name ?? ''}:</span>
            <span className="font-semibold text-white">{entry.value?.toFixed(1)} m/s</span>
          </div>
        ))}
      </div>
    );
  };

  if (allData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No data available for {stationName}
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
          {stationName} — Wind Timeline
          {historyIsModelled && (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-700 text-slate-400"
              title="Past wind shown is from Open-Meteo model — no measured station nearby."
            >
              past = model
            </span>
          )}
        </h3>
        <div className="inline-flex rounded-lg bg-slate-900/60 p-0.5 border border-slate-700">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => {
            const active = range === k;
            return (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                aria-pressed={active}
              >
                {RANGES[k].label}
              </button>
            );
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          {/* Background color bands for condition levels */}
          <ReferenceArea y1={0} y2={4} fill="#9ca3af" fillOpacity={0.08} />
          <ReferenceArea y1={4} y2={6} fill="#fbbf24" fillOpacity={0.1} />
          <ReferenceArea y1={6} y2={13} fill="#22c55e" fillOpacity={0.08} />
          <ReferenceArea y1={13} y2={20} fill="#f97316" fillOpacity={0.1} />

          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />

          <XAxis
            dataKey="time"
            type="number"
            domain={[windowStart, windowEnd]}
            allowDataOverflow
            scale="time"
            tickFormatter={formatAxisTime}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
            axisLine={{ stroke: '#334155' }}
            minTickGap={40}
          />
          <YAxis
            domain={[0, 20]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
            axisLine={{ stroke: '#334155' }}
            tickFormatter={(v: number) => `${v}`}
            label={{ value: 'm/s', position: 'insideLeft', fill: '#64748b', fontSize: 11, dy: 40 }}
          />

          <Tooltip content={customTooltip} />

          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: '12px', paddingTop: '8px' }}
          />

          {/* Now reference line — make it loud so users always see where "now" is */}
          <ReferenceLine
            x={nowEpoch}
            stroke="#facc15"
            strokeDasharray="6 3"
            strokeWidth={2}
            ifOverflow="extendDomain"
            label={{
              value: '◀ NOW',
              position: 'insideTopRight',
              fill: '#facc15',
              fontSize: 11,
              fontWeight: 600,
            }}
          />

          {/* Observed avg */}
          <Line
            dataKey="obsAvg"
            name={historyIsModelled ? 'Past avg (model)' : 'Obs avg'}
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {/* Observed gust */}
          <Line
            dataKey="obsGust"
            name={historyIsModelled ? 'Past gust (model)' : 'Obs gust'}
            stroke="#93c5fd"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {/* Forecast avg */}
          <Line
            dataKey="fctAvg"
            name="Fct avg"
            stroke="#6366f1"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {/* Forecast gust */}
          <Line
            dataKey="fctGust"
            name="Fct gust"
            stroke="#a5b4fc"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-slate-500 justify-center flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-6 h-0.5 bg-gray-400 opacity-30 align-middle"></span>
          <span className="w-3 h-3 rounded-sm inline-block align-middle" style={{ background: '#9ca3af22' }}></span>
          Too little (&lt;4)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block align-middle" style={{ background: '#fbbf2422' }}></span>
          OK (4–6)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block align-middle" style={{ background: '#22c55e22' }}></span>
          Great (6–13)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block align-middle" style={{ background: '#f9731622' }}></span>
          Crazy (&gt;13)
        </span>
      </div>
    </div>
  );
}
