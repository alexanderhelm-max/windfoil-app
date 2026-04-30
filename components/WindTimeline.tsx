'use client';

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
}

interface ChartDataPoint {
  time: number; // epoch ms
  label: string;
  obsAvg?: number;
  obsGust?: number;
  fctAvg?: number;
  fctGust?: number;
}

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

export default function WindTimeline({ stationName, history, forecast }: WindTimelineProps) {
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

  const chartData = Array.from(dataMap.values()).sort((a, b) => a.time - b.time);

  // Bridge: stamp the last observed values onto the last obs point as forecast values,
  // AND onto the first forecast point as obs values — so both lines visually connect
  const lastObsIdx = chartData.reduce((best, p, i) => (p.obsAvg !== undefined ? i : best), -1);
  const firstFctIdx = chartData.findIndex((p) => p.fctAvg !== undefined);
  if (lastObsIdx >= 0 && firstFctIdx >= 0) {
    // Anchor the forecast line at the last observed point
    chartData[lastObsIdx].fctAvg = chartData[lastObsIdx].obsAvg;
    chartData[lastObsIdx].fctGust = chartData[lastObsIdx].obsGust;
    // Anchor the obs line at the first forecast point
    chartData[firstFctIdx].obsAvg = chartData[firstFctIdx].fctAvg;
    chartData[firstFctIdx].obsGust = chartData[firstFctIdx].fctGust;
  }

  const nowEpoch = Date.now();

  const customTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { name: string; value: number; color: string }[];
    label?: number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-300 mb-2 font-medium">
          {label !== undefined ? formatTooltipTime(label) : ''}
        </p>
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span style={{ color: entry.color }}>{entry.name}:</span>
            <span className="font-semibold text-white">{entry.value?.toFixed(1)} m/s</span>
          </div>
        ))}
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No data available for {stationName}
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4 text-slate-200">
        {stationName} — Wind Timeline
      </h3>
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
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={formatAxisTime}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
            axisLine={{ stroke: '#334155' }}
            minTickGap={60}
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

          {/* Now reference line */}
          <ReferenceLine
            x={nowEpoch}
            stroke="#f1f5f9"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: 'Now', position: 'top', fill: '#f1f5f9', fontSize: 11 }}
          />

          {/* Observed avg */}
          <Line
            dataKey="obsAvg"
            name="Obs avg"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {/* Observed gust */}
          <Line
            dataKey="obsGust"
            name="Obs gust"
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
