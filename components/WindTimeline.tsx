'use client';

import { useState } from 'react';
import {
  ComposedChart,
  Area,
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
  /** [avg, gust] drawn as a shaded band instead of a second measured line */
  obsBand?: [number, number];
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

/** Clear air kept above the highest reading so the arrow row never sits on it. */
const ARROW_HEADROOM = 3;

/**
 * One declaration of each series' colour, shared by the chart and the tooltip
 * so the two can't drift apart.
 *
 * Measured wind is the only white, solid, full-strength line — it's the ground
 * truth and should read that way without consulting the legend. The forecasts
 * are dimmer and dashed, and sit far enough apart in hue (indigo ~234°, teal
 * ~174°) to stay distinct. The previous palette put observed on blue-500 and
 * Open-Meteo on indigo-500, only 22° apart: fine while the two never shared an
 * x-position, unreadable now that the forecast runs back across the measured
 * day.
 */
const SERIES = {
  obs: '#ffffff',
  obsGust: '#cbd5e1',
  om: '#818cf8',
  smhi: '#2dd4bf',
} as const;

/** How far the tooltip will reach to pair up readings taken on different clocks. */
const TOOLTIP_SNAP_MS = 30 * 60 * 1000;

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
  /** Time under the cursor; null means the readout shows the present instead. */
  const [hoverTime, setHoverTime] = useState<number | null>(null);
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

  // Add forecast data points. These now reach back over the past day too, so
  // the forecast line runs alongside the measured one and its track record is
  // visible rather than assumed.
  const haveObsDir = (history?.windDir.length ?? 0) > 0;
  for (const f of forecast) {
    const t = new Date(f.time).getTime();
    const existing = dataMap.get(t) ?? { time: t, label: formatAxisTime(t) };
    existing.fctAvg = f.windSpeed;
    existing.fctGust = f.gust;
    // The arrow row should show what was measured wherever a measurement
    // exists, so the model only supplies a heading from NOW forward — or for
    // the whole window when there's no observed direction at all.
    if (existing.dir === undefined && (t >= nowEpoch || !haveObsDir)) {
      existing.dir = f.windDir;
    }
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

  // Deliberately NOT bridged. Stamping the last measured value into the
  // forecast series joined the lines, but drew the forecast through a value it
  // never predicted — invisible when the forecast is close, and a near-vertical
  // cliff when it's off by 3 m/s, misrepresenting both series. Each line now
  // shows only its own data, and the gap at NOW is the honest reading: it is
  // how far the forecast currently sits from what's actually blowing.

  // The axis tracks the readings in both directions. It used to have a floor of
  // 20, which on a 8 m/s day squeezed every line into the bottom 40% of the
  // plot and left the rest empty — the single biggest reason six series looked
  // like a tangle. The floor is now 10, low enough to let a light day fill the
  // frame but high enough that "nowhere near rideable" still reads as such.
  // Only series that are actually drawn count, so a hidden one can't inflate it.
  const maxReading = chartData.reduce((m, p) => {
    const vals = [p.obsAvg, p.obsGust, p.fctAvg, p.fctGust, p.smhiAvg];
    return vals.reduce((a: number, v) => (typeof v === 'number' && v > a ? v : a), m);
  }, 0);
  const axisMax = Math.max(10, Math.ceil(maxReading) + ARROW_HEADROOM);
  const arrowY = axisMax - ARROW_HEADROOM / 2;

  // Round ticks rather than whatever the axis maximum happens to be — a moving
  // maximum otherwise puts an arbitrary "13" at the top. The step keeps 4 and 6
  // on gridlines at normal scales, so the condition thresholds line up with the
  // band edges instead of floating between them.
  const tickStep = axisMax <= 14 ? 2 : axisMax <= 30 ? 5 : 10;
  const yTicks: number[] = [];
  for (let v = 0; v <= axisMax; v += tickStep) yTicks.push(v);

  // Condition bands, clipped to the axis. Recharts discards a ReferenceArea
  // that overflows the domain, so an unclipped 6–13 band would vanish entirely
  // on a calm day — taking the "Great" reference with it.
  const bands = [
    { from: 0, to: 4, fill: '#9ca3af', opacity: 0.08 },
    { from: 4, to: 6, fill: '#fbbf24', opacity: 0.1 },
    { from: 6, to: 13, fill: '#22c55e', opacity: 0.08 },
    { from: 13, to: axisMax, fill: '#f97316', opacity: 0.1 },
  ]
    .filter((b) => b.from < axisMax)
    .map((b) => ({ ...b, to: Math.min(b.to, axisMax) }));

  // Space the arrows by time rather than by index: sources differ in density,
  // so every Nth point would bunch up on 10-minute data and thin out on hourly.
  // Measured gust becomes a band from avg to gust rather than its own line.
  // Three separate gust lines were mostly noise; as a band the gustiness reads
  // as a thickness you take in at a glance instead of a line you have to trace.
  for (const p of chartData) {
    if (p.obsAvg !== undefined && p.obsGust !== undefined) {
      p.obsBand = [p.obsAvg, p.obsGust];
    }
  }

  const arrowStepMs = RANGES[range].arrowEveryH * 3600 * 1000;
  let lastArrowAt = -Infinity;
  for (const p of chartData) {
    if (p.dir === undefined) continue;
    if (p.time - lastArrowAt < arrowStepMs) continue;
    p.dirY = arrowY;
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

  interface TooltipPropsLoose {
    active?: boolean;
    payload?: unknown[];
    label?: string | number;
  }

  /**
   * Nearest point that actually carries `key`, within the snap window.
   *
   * Recharts hands the tooltip only the row under the cursor, and the sources
   * are on different clocks: the station reports on its own minutes, the models
   * on whole hours. So a row is nearly always measured-only or forecast-only,
   * and hovering gave you one or the other — never the comparison. Reading each
   * series from the nearest row it exists on puts them side by side, with the
   * real timestamp shown whenever it isn't the one being hovered.
   */
  const nearestWith = (t: number, key: keyof ChartDataPoint) => {
    let best: ChartDataPoint | undefined;
    let bestDelta = Infinity;
    for (const p of chartData) {
      if (p[key] === undefined) continue;
      const d = Math.abs(p.time - t);
      if (d < bestDelta) {
        bestDelta = d;
        best = p;
      }
    }
    return best && bestDelta <= TOOLTIP_SNAP_MS ? best : undefined;
  };

  const obsLabel = historyIsModelled ? 'Past' : 'Obs';
  const primaryName = forecastSource === 'smhi' ? 'SMHI' : 'OM';
  /** avg and gust per source — read as a range, matching the shaded band. */
  const readoutGroups: {
    label: string;
    color: string;
    avg: keyof ChartDataPoint;
    gust: keyof ChartDataPoint;
  }[] = [
    { label: obsLabel, color: SERIES.obs, avg: 'obsAvg', gust: 'obsGust' },
    { label: primaryName, color: SERIES.om, avg: 'fctAvg', gust: 'fctGust' },
    // SMHI's gust is drawn nowhere — worth a number, not a sixth line.
    ...(forecastSmhi.length > 0
      ? [{ label: 'SMHI', color: SERIES.smhi, avg: 'smhiAvg' as const, gust: 'smhiGust' as const }]
      : []),
  ];

  // Suppressed while the row shows the present, for the same reason as the
  // crosshair: a dot left over the last mouse position points at a time the
  // numbers above aren't describing.
  const activeDot = hoverTime === null ? false : { r: 3.5, strokeWidth: 0 };

  const track = (s: { activeLabel?: string | number }) => {
    const t = typeof s?.activeLabel === 'number' ? s.activeLabel : Number(s?.activeLabel);
    setHoverTime(isNaN(t) ? null : t);
  };

  const hhmm = (t: number) =>
    new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  /**
   * The readout row above the plot.
   *
   * This used to be a tooltip floating over the chart, which covered exactly
   * the part you were trying to read — worst around NOW, where you look most.
   * Sitting above the plot it can never occlude anything, and it earns its
   * space at rest too: the current conditions are now readable without
   * touching the mouse, where before you had to hover to see a single number.
   */
  const readoutAt = (t: number) => {
    const groups = readoutGroups
      .map((g) => {
        const avgP = nearestWith(t, g.avg);
        if (!avgP) return null;
        const gustP = nearestWith(t, g.gust);
        return {
          ...g,
          avgValue: avgP[g.avg] as number,
          gustValue: gustP ? (gustP[g.gust] as number) : undefined,
          // Sources run on different clocks; say so rather than implying these
          // readings share a timestamp with the one in the header.
          at: Math.abs(avgP.time - t) >= 60_000 ? avgP.time : null,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
    return { groups, dir: nearestWith(t, 'dir')?.dir };
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

      {(() => {
        const at = hoverTime ?? nowEpoch;
        const { groups, dir } = readoutAt(at);
        return (
          <div className="mb-2 flex items-baseline gap-x-4 gap-y-1 flex-wrap text-sm min-h-[26px]">
            <span className="text-slate-400 font-medium tabular-nums shrink-0">
              {hoverTime === null ? 'Now' : formatTooltipTime(hoverTime)}
            </span>
            {groups.map((g) => (
              <span key={g.label} className="flex items-baseline gap-1.5 tabular-nums">
                <span style={{ color: g.color }}>{g.label}</span>
                {/* No space around the dash, or "6.2 –8.8" reads as a negative
                    number instead of the avg-to-gust range the band shows. */}
                <span>
                  <span className="font-semibold text-white">{g.avgValue.toFixed(1)}</span>
                  {g.gustValue !== undefined && (
                    <span className="text-slate-400">–{g.gustValue.toFixed(1)}</span>
                  )}
                </span>
                {g.at && <span className="text-xs text-slate-500">{hhmm(g.at)}</span>}
              </span>
            ))}
            {groups.length > 0 && <span className="text-slate-500 text-xs">m/s</span>}
            {dir !== undefined && (
              <span className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-slate-400">from</span>
                <span className="font-semibold text-white">
                  {headingToCompass(dir)} {Math.round(dir)}°
                </span>
                {hasSectors && (
                  <span
                    className="text-xs"
                    style={{
                      color: isGoodWindDirection(dir, goodSectors)
                        ? conditionColors.great
                        : '#94a3b8',
                    }}
                  >
                    {isGoodWindDirection(dir, goodSectors) ? 'works here' : 'off-sector'}
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })()}

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          // Covers touch as well: Recharts routes a dragged finger through the
          // same handler, so the readout follows on a phone without a separate
          // touch path. Lifting the finger leaves the last reading up rather
          // than snapping back to Now, which is what you want on a phone.
          onMouseMove={track}
          onMouseLeave={() => setHoverTime(null)}
        >
          {/* Background color bands for condition levels */}
          {bands.map((b) => (
            <ReferenceArea
              key={b.from}
              y1={b.from}
              y2={b.to}
              fill={b.fill}
              fillOpacity={b.opacity}
            />
          ))}

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
            domain={[0, axisMax]}
            ticks={yTicks}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={{ stroke: '#334155' }}
            axisLine={{ stroke: '#334155' }}
            tickFormatter={(v: number) => `${v}`}
            label={{ value: 'm/s', position: 'insideLeft', fill: '#64748b', fontSize: 11, dy: 40 }}
          />

          {/* No panel — the numbers live in the readout row above. Kept only
              for the crosshair, which ties that row to a place on the plot.
              Hidden while the row is showing the present, so a stale crosshair
              can't point somewhere the numbers aren't. */}
          <Tooltip
            content={() => null}
            cursor={
              hoverTime === null
                ? false
                : { stroke: '#e2e8f0', strokeWidth: 1, strokeOpacity: 0.7 }
            }
          />

          {/* Spelled out rather than derived from child order, which would put
              the gust band ahead of the measured line it belongs to, and would
              draw the band as a line. Measured leads; forecasts follow. */}
          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: '12px', paddingTop: '8px' }}
            payload={[
              { value: `${obsLabel} avg`, type: 'line', color: SERIES.obs, id: 'obsAvg' },
              { value: `${obsLabel} gust`, type: 'rect', color: SERIES.obsGust, id: 'obsBand' },
              { value: `${primaryName} avg`, type: 'line', color: SERIES.om, id: 'fctAvg' },
              { value: `${primaryName} gust`, type: 'line', color: SERIES.om, id: 'fctGust' },
              ...(forecastSmhi.length > 0
                ? [{ value: 'SMHI avg', type: 'line' as const, color: SERIES.smhi, id: 'smhiAvg' }]
                : []),
            ]}
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

          {/* Measured gust, as the spread above the average rather than a line.
              Drawn first so the lines sit on top of it. */}
          <Area
            dataKey="obsBand"
            name={`${obsLabel} gust`}
            stroke="none"
            fill={SERIES.obsGust}
            fillOpacity={0.16}
            activeDot={false}
            connectNulls
            isAnimationActive={false}
          />
          {/* Measured avg — the ground truth, and the only line drawn as such */}
          <Line
            dataKey="obsAvg"
            name={`${obsLabel} avg`}
            stroke={SERIES.obs}
            strokeWidth={2.5}
            dot={false}
            activeDot={activeDot}
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast avg (primary) */}
          <Line
            dataKey="fctAvg"
            name={forecastSource === 'smhi' ? 'SMHI avg' : 'OM avg'}
            stroke={SERIES.om}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            activeDot={activeDot}
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast gust — the only gust line left, kept faint. The second
              opinion's gust is in the tooltip instead of on the plot. */}
          <Line
            dataKey="fctGust"
            name={forecastSource === 'smhi' ? 'SMHI gust' : 'OM gust'}
            stroke={SERIES.om}
            strokeWidth={1.25}
            strokeDasharray="2 3"
            strokeOpacity={0.5}
            dot={false}
            activeDot={activeDot}
            connectNulls
            isAnimationActive={false}
          />
          {/* Forecast avg (second opinion: SMHI point forecast) */}
          {forecastSmhi.length > 0 && (
            <Line
              dataKey="smhiAvg"
              name="SMHI avg"
              stroke={SERIES.smhi}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={activeDot}
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
