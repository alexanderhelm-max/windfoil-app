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
import {
  WindSector,
  isGoodWindDirection,
  headingToCompass,
  conditionColors,
} from '@/lib/wind-utils';

interface WindTimelineProps {
  spotName: string;
  history: SmhiObsHistory | null;
  forecast: ForecastPoint[];
  /** Second forecast opinion (SMHI point forecast) rendered alongside the primary */
  forecastSmhi?: ForecastPoint[];
  /** True when history came from Open-Meteo model rather than measured SMHI obs */
  historyIsModelled?: boolean;
  /** Source of measured past wind: which provider/station and how far away */
  obsStation?: { id: number; name: string; distanceKm: number; provider?: 'viva' | 'smhi' } | null;
  /** Which forecast model produced the forecast points */
  forecastSource?: 'open-meteo' | 'smhi' | null;
  /** Working sectors, used to colour the direction arrows */
  goodSectors?: WindSector[];
}

interface ChartDataPoint {
  time: number; // epoch ms
  label: string;
  obsAvg?: number;
  obsGust?: number;
  /** Wind bearing at this time, drawn as an arrow near the top of the plot */
  dir?: number;
  /** Set only on the points chosen to carry an arrow, so they don't crowd */
  dirY?: number;
  fctAvg?: number;
  fctGust?: number;
  smhiAvg?: number;
  smhiGust?: number;
}

type RangeKey = 'now' | 'today' | 'ahead';
/** arrowEveryH keeps the direction row legible as the window widens. */
const RANGES: Record<
  RangeKey,
  { label: string; pastH: number; futureH: number; arrowEveryH: number }
> = {
  now: { label: 'Now', pastH: 2, futureH: 4, arrowEveryH: 1 },
  today: { label: 'Today', pastH: 4, futureH: 12, arrowEveryH: 2 },
  ahead: { label: 'Ahead', pastH: 0, futureH: 96, arrowEveryH: 6 },
};

/** Height in the 0–20 m/s domain where the arrow row sits. */
const ARROW_Y = 18.6;

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
  spotName,
  history,
  forecast,
  forecastSmhi = [],
  historyIsModelled = false,
  obsStation = null,
  forecastSource = null,
  goodSectors,
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
    const obsDirMap = new Map<number, number>();
    for (const p of history.windDir) {
      obsDirMap.set(p.time, p.value);
    }

    // Use windSpeed times as anchor
    for (const p of history.windSpeed) {
      const existing = dataMap.get(p.time) ?? { time: p.time, label: formatAxisTime(p.time) };
      existing.obsAvg = obsSpeedMap.get(p.time);
      existing.obsGust = obsGustMap.get(p.time);
      existing.dir = obsDirMap.get(p.time);
      dataMap.set(p.time, existing);
    }
  }

  // Add forecast data points
  for (const f of forecast) {
    const t = new Date(f.time).getTime();
    const existing = dataMap.get(t) ?? { time: t, label: formatAxisTime(t) };
    existing.fctAvg = f.windSpeed;
    existing.fctGust = f.gust;
    existing.dir = existing.dir ?? f.windDir;
    dataMap.set(t, existing);
  }
  for (const f of forecastSmhi) {
    const t = new Date(f.time).getTime();
    const existing = dataMap.get(t) ?? { time: t, label: formatAxisTime(t) };
    existing.smhiAvg = f.windSpeed;
    existing.smhiGust = f.gust;
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
  // Same anchoring for the second forecast source, so the teal line also
  // departs from the measured NOW point rather than floating in from nowhere.
  if (lastObsIdx >= 0 && chartData.some((p) => p.smhiAvg !== undefined)) {
    chartData[lastObsIdx].smhiAvg = chartData[lastObsIdx].obsAvg;
    chartData[lastObsIdx].smhiGust = chartData[lastObsIdx].obsGust;
  }

  // Space the arrows by time rather than by index: sources differ in density,
  // so every Nth point would bunch up on 10-minute data and thin out on hourly.
  const arrowStepMs = RANGES[range].arrowEveryH * 3600 * 1000;
  let lastArrowAt = -Infinity;
  for (const p of chartData) {
    if (p.dir === undefined) continue;
    if (p.time - lastArrowAt < arrowStepMs) continue;
    p.dirY = ARROW_Y;
    lastArrowAt = p.time;
  }

  /**
   * One wind arrow, pointing where the wind is going (bearing + 180°).
   *
   * Colour only claims something when the spot has working sectors set: green
   * for wind it can use, muted for wind it can't. Without sectors we don't
   * know, so every arrow stays neutral rather than implying approval.
   */
  interface DotProps {
    cx?: number;
    cy?: number;
    payload?: ChartDataPoint;
  }
  const hasSectors = !!goodSectors && goodSectors.length > 0;
  const DirectionArrow = ({ cx, cy, payload }: DotProps) => {
    if (cx == null || cy == null || payload?.dir === undefined || payload.dirY === undefined) {
      return null;
    }
    const color = !hasSectors
      ? '#94a3b8'
      : isGoodWindDirection(payload.dir, goodSectors)
        ? conditionColors.great
        : '#64748b';
    return (
      <g transform={`translate(${cx},${cy}) rotate(${(payload.dir + 180) % 360})`}>
        <path d="M0,-7 L-3.6,7 L0,4 L3.6,7 Z" fill={color} />
      </g>
    );
  };

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
    const point = chartData.find((p) => p.time === labelNum);
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-300 mb-2 font-medium">
          {!isNaN(labelNum) ? formatTooltipTime(labelNum) : ''}
        </p>
        {payload
          .filter((entry) => entry.name !== 'dir')
          .map((entry, i) => (
            <div key={entry.name ?? i} className="flex items-center gap-2">
              <span style={{ color: entry.color ?? '#94a3b8' }}>{entry.name ?? ''}:</span>
              <span className="font-semibold text-white">{entry.value?.toFixed(1)} m/s</span>
            </div>
          ))}
        {point?.dir !== undefined && (
          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-700">
            <span className="text-slate-400">Wind from:</span>
            <span className="font-semibold text-white">
              {headingToCompass(point.dir)} {Math.round(point.dir)}°
            </span>
            {hasSectors && (
              <span
                className="text-xs"
                style={{
                  color: isGoodWindDirection(point.dir, goodSectors)
                    ? conditionColors.great
                    : '#94a3b8',
                }}
              >
                {isGoodWindDirection(point.dir, goodSectors) ? 'works here' : 'off-sector'}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  if (allData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No data available for {spotName}
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
          {spotName} — Wind Timeline
          {!history || (history.windSpeed.length === 0 && history.gust.length === 0) ? null : historyIsModelled ? (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-700 text-slate-400"
              title="Past wind shown is from Open-Meteo model — no measured station with fresh data nearby."
            >
              past = model
            </span>
          ) : obsStation ? (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300"
              title={`Past wind measured at ${obsStation.provider === 'viva' ? 'VIVA' : 'SMHI'} station ${obsStation.name}, ${obsStation.distanceKm.toFixed(0)} km away.`}
            >
              past: {obsStation.provider === 'viva' ? 'VIVA' : 'SMHI'} {obsStation.name} ·{' '}
              {obsStation.distanceKm < 1.5 ? '<2' : obsStation.distanceKm.toFixed(0)} km
            </span>
          ) : (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300"
              title="Past wind measured at the station paired with this spot."
            >
              past: measured
            </span>
          )}
          {forecast.length > 0 && forecastSource && (
            <span
              className="text-xs font-normal px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300"
              title={
                forecastSmhi.length > 0
                  ? 'Two forecast opinions: Open-Meteo (indigo) and SMHI point forecast (teal). Where they agree, trust it more.'
                  : forecastSource === 'smhi'
                    ? 'Forecast from SMHI point forecast (Open-Meteo was unavailable).'
                    : 'Forecast from Open-Meteo (blend of weather models).'
              }
            >
              fct: {forecastSmhi.length > 0 ? 'Open-Meteo + SMHI' : forecastSource === 'smhi' ? 'SMHI' : 'Open-Meteo'}
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

          {/* Wind direction: an invisible line whose dots are the arrows, so
              Recharts places them on the time axis for us. Legend entry hidden
              — the arrows explain themselves. */}
          <Line
            dataKey="dirY"
            name="dir"
            stroke="transparent"
            legendType="none"
            dot={<DirectionArrow />}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />

          {/* Observed avg */}
          <Line
            dataKey="obsAvg"
            name={historyIsModelled ? 'Past avg (model)' : 'Obs avg'}
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            connectNulls
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
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast avg (primary) */}
          <Line
            dataKey="fctAvg"
            name={forecastSource === 'smhi' ? 'SMHI avg' : 'OM avg'}
            stroke="#6366f1"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast gust (primary) */}
          <Line
            dataKey="fctGust"
            name={forecastSource === 'smhi' ? 'SMHI gust' : 'OM gust'}
            stroke="#a5b4fc"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast avg (second opinion: SMHI point forecast) */}
          {forecastSmhi.length > 0 && (
            <Line
              dataKey="smhiAvg"
              name="SMHI avg"
              stroke="#2dd4bf"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {forecastSmhi.length > 0 && (
            <Line
              dataKey="smhiGust"
              name="SMHI gust"
              stroke="#99f6e4"
              strokeWidth={1}
              strokeDasharray="2 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
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
