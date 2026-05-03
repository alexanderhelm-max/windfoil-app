export type ConditionLevel = 'too-little' | 'ok' | 'great' | 'crazy';
export type GustLevel = 'smooth' | 'moderate' | 'gusty';
export type TrendDirection = 'building' | 'steady' | 'dropping';

export function isGoodWindDirection(heading: number): boolean {
  return heading >= 180 && heading <= 315;
}

export function getCondition(windSpeed: number, heading: number): ConditionLevel {
  const offset = isGoodWindDirection(heading) ? 0 : 1;
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

export function getTrend(observations: { time: number; wind: number }[]): TrendDirection {
  if (observations.length < 2) return 'steady';
  const recent = observations.slice(-3);
  if (recent.length < 2) return 'steady';
  const first = recent[0].wind;
  const last = recent[recent.length - 1].wind;
  const hoursDiff = (recent[recent.length - 1].time - recent[0].time) / 3600000;
  if (hoursDiff === 0) return 'steady';
  const rate = (last - first) / hoursDiff;
  if (rate > 0.5) return 'building';
  if (rate < -0.5) return 'dropping';
  return 'steady';
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

/** Trend direction + rate (m/s per hour) — same data as getTrend, with magnitude. */
export function getTrendDetail(
  observations: { time: number; wind: number }[]
): { direction: TrendDirection; ratePerHour: number } {
  if (observations.length < 2) return { direction: 'steady', ratePerHour: 0 };
  const recent = observations.slice(-3);
  if (recent.length < 2) return { direction: 'steady', ratePerHour: 0 };
  const first = recent[0].wind;
  const last = recent[recent.length - 1].wind;
  const hoursDiff = (recent[recent.length - 1].time - recent[0].time) / 3600000;
  if (hoursDiff === 0) return { direction: 'steady', ratePerHour: 0 };
  const rate = (last - first) / hoursDiff;
  let direction: TrendDirection = 'steady';
  if (rate > 0.5) direction = 'building';
  else if (rate < -0.5) direction = 'dropping';
  return { direction, ratePerHour: rate };
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
