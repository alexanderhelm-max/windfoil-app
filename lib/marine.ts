import { fetchJsonWithDiag } from './fetch-json';

/**
 * Sea state from Open-Meteo's Marine API — free, keyless, same shape as their
 * forecast API.
 *
 * Wind wave and swell are kept apart on purpose: 0.6 m of wind chop at 3 s is a
 * rattly ride, 0.6 m of swell at 9 s is something to surf. A single wave height
 * can't tell those apart, so period travels with every height.
 *
 * Wave models resolve open coast well and sheltered archipelago badly. A point
 * behind islands gets values from the nearest wet cell, which may be nothing
 * like the water at the launch — so a spot can be marked sheltered and skip
 * this entirely, and what is shown is always labelled as model output.
 */

export type SeaState = 'chop' | 'mixed' | 'swell';

export interface MarineNow {
  /** Combined significant wave height, metres. */
  waveHeight: number;
  /** Peak period, seconds. Null when the model reports height but no period. */
  wavePeriod: number | null;
  waveDirection: number | null;
  swellHeight: number | null;
  swellPeriod: number | null;
  windWaveHeight: number | null;
  windWavePeriod: number | null;
}

export interface MarineResult {
  now: MarineNow | null;
  error: string | null;
}

/**
 * Short vs long period is what separates chop you fight from swell you ride.
 * Thresholds follow common practice for coastal sea state rather than anything
 * foil-specific; they exist to label, not to advise.
 */
export function seaState(periodSeconds: number | null): SeaState | null {
  if (periodSeconds == null || !isFinite(periodSeconds)) return null;
  if (periodSeconds < 5) return 'chop';
  if (periodSeconds <= 8) return 'mixed';
  return 'swell';
}

const HOURLY = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'wind_wave_height',
  'wind_wave_period',
  'swell_wave_height',
  'swell_wave_period',
].join(',');

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

export async function fetchMarine(lat: number, lon: number): Promise<MarineResult> {
  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${lat}&longitude=${lon}&hourly=${HOURLY}` +
    `&timezone=GMT&forecast_days=1&past_days=0`;
  const { data, error } = await fetchJsonWithDiag(url, { timeoutMs: 8000, revalidate: 1800 });
  if (error || !data) return { now: null, error: error ?? 'no data' };

  const body = data as { hourly?: Record<string, unknown>; reason?: string };
  // Open-Meteo answers inland or unmodelled points with an error body rather
  // than an empty series; treat that as "no sea here", not as a failure.
  if (body.reason) return { now: null, error: body.reason };

  const hourly = body.hourly ?? {};
  const times = (hourly.time as string[]) ?? [];
  if (times.length === 0) return { now: null, error: 'empty series' };

  // Nearest hour to now — the series is hourly and starts at midnight UTC.
  const now = Date.now();
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < times.length; i++) {
    const gap = Math.abs(new Date(`${times[i]}Z`).getTime() - now);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  if (best < 0) return { now: null, error: 'no usable timestamps' };

  const at = (key: string) => num((hourly[key] as unknown[] | undefined)?.[best]);
  const waveHeight = at('wave_height');
  // Height is the one field everything else hangs off; without it there's
  // nothing worth showing even if a period came back.
  if (waveHeight == null) return { now: null, error: 'no wave height at this point' };

  return {
    now: {
      waveHeight,
      wavePeriod: at('wave_period'),
      waveDirection: at('wave_direction'),
      swellHeight: at('swell_wave_height'),
      swellPeriod: at('swell_wave_period'),
      windWaveHeight: at('wind_wave_height'),
      windWavePeriod: at('wind_wave_period'),
    },
    error: null,
  };
}
