export type ConditionLevel = 'too-little' | 'ok' | 'great' | 'crazy';
export type GustLevel = 'smooth' | 'moderate' | 'gusty';
export type TrendDirection = 'building' | 'steady' | 'dropping';

export interface WindSector {
  /** Degrees the wind blows FROM, inclusive. Wraps when from > to. */
  from: number;
  to: number;
}

/**
 * Is the wind coming from a direction this spot works in?
 *
 * Spots with no sectors configured return true: their geometry is unknown, and
 * a single rule can't describe a harbour, an open beach and an island channel
 * at once. Unknown means "don't penalise", not "assume bad".
 */
export function isGoodWindDirection(heading: number, sectors?: WindSector[]): boolean {
  if (!sectors || sectors.length === 0) return true;
  const h = ((heading % 360) + 360) % 360;
  return sectors.some(({ from, to }) => (from <= to ? h >= from && h <= to : h >= from || h <= to));
}

/**
 * Wind off a spot's working sectors needs 1 m/s more to reach each level —
 * cross-shore or offshore wind is choppier and less usable at the same speed.
 * Spots without sectors are graded on speed alone.
 */
export function getCondition(
  windSpeed: number,
  heading: number,
  sectors?: WindSector[]
): ConditionLevel {
  const offset = isGoodWindDirection(heading, sectors) ? 0 : 1;
  if (windSpeed < 4 + offset) return 'too-little';
  if (windSpeed < 6 + offset) return 'ok';
  if (windSpeed <= 13 + offset) return 'great';
  return 'crazy';
}

export function getGustLevel(avg: number, gust: number): GustLevel {
  if (avg === 0) return 'smooth';
  const ratio = gust / avg;
  if (ratio < 1.3) return 'smooth';
  if (ratio < 1.5) return 'moderate';
  return 'gusty';
}

export function headingToCompass(heading: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(heading / 22.5) % 16];
}

export const conditionColors: Record<ConditionLevel, string> = {
  'too-little': '#9ca3af',
  'ok': '#fbbf24',
  'great': '#22c55e',
  'crazy': '#f97316',
};

export const conditionLabels: Record<ConditionLevel, string> = {
  'too-little': 'Too little',
  'ok': 'OK',
  'great': 'Great!',
  'crazy': 'Crazy fun',
};

export const trendIcons: Record<TrendDirection, string> = {
  building: '↑',
  steady: '→',
  dropping: '↓',
};

/**
 * Wind trend over the last hour, as m/s per hour.
 *
 * Fits a least-squares line through the readings in the window rather than
 * differencing the last few samples: sources differ in density (VIVA reports
 * every 10 minutes, SMHI hourly) and gusty readings make any two-point
 * comparison jumpy. Returns null when the window is too thin or too short to
 * describe a trend — better no arrow than a confident wrong one.
 */
export function getHourTrend(
  observations: { time: number; wind: number }[],
  windowMs = 3600_000
): { direction: TrendDirection; ratePerHour: number } | null {
  if (observations.length < 2) return null;
  const newest = observations[observations.length - 1].time;
  const pts = observations.filter((o) => newest - o.time <= windowMs);
  if (pts.length < 2) return null;
  const spanMs = pts[pts.length - 1].time - pts[0].time;
  if (spanMs < 20 * 60_000) return null;

  // Regress wind on hours-from-window-start.
  const xs = pts.map((p) => (p.time - pts[0].time) / 3600_000);
  const ys = pts.map((p) => p.wind);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const ratePerHour = num / den;
  let direction: TrendDirection = 'steady';
  if (ratePerHour > 0.5) direction = 'building';
  else if (ratePerHour < -0.5) direction = 'dropping';
  return { direction, ratePerHour };
}

/** Wetsuit recommendation based on water temperature. Returns null if no temp known. */
export function getWetsuitHint(waterTempC?: number): string | null {
  if (waterTempC === undefined || waterTempC === null) return null;
  if (waterTempC >= 20) return 'Boardshorts';
  if (waterTempC >= 17) return 'Shorty / 2 mm';
  if (waterTempC >= 13) return '3/2 mm';
  if (waterTempC >= 9) return '4/3 mm + boots';
  if (waterTempC >= 5) return '5/4 mm + boots + hood';
  return '6/5 mm + boots + hood + gloves';
}

/** Suggested wing/sail size based on wind speed (m/s) for ~80kg rider. */
export function getWingHint(avgWind: number): string | null {
  if (avgWind < 4) return null; // not foilable
  if (avgWind < 6) return '5–6 m wing';
  if (avgWind < 9) return '4–5 m wing';
  if (avgWind < 12) return '3.5–4 m wing';
  if (avgWind < 15) return '3–3.5 m wing';
  if (avgWind < 18) return '2.5–3 m wing';
  return '2 m wing or wait';
}

/** Smallest unsigned angle between two bearings (0–180°). */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(((b - a + 540) % 360) - 180);
  return d;
}
