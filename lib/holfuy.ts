import { VivaObservation } from './viva';

/**
 * Holfuy live wind API — small weather stations typically mounted at the
 * launch spot itself by local wind-sport communities, updating every minute.
 *
 * Requires an API key (their `pw` query parameter): register at holfuy.com
 * and request API access, then set HOLFUY_API_KEY in the environment
 * (Vercel project settings for production). Stations are added per spot via
 * their numeric id, visible in the station URL on holfuy.com.
 *
 * Response shape (single station, m=JSON):
 *   { stationId, stationName, dateTime,
 *     wind: { speed, gust, min, unit, direction }, temperature }
 * Errors come back as non-JSON text or an error field — both handled.
 */
export interface HolfuyResult {
  obs: VivaObservation | null;
  stationName: string | null;
  error: string | null;
}

export async function fetchHolfuyStation(id: number): Promise<HolfuyResult> {
  const key = process.env.HOLFUY_API_KEY;
  if (!key) {
    return { obs: null, stationName: null, error: 'HOLFUY_API_KEY not configured' };
  }
  try {
    const url =
      `https://api.holfuy.com/live/?s=${id}&pw=${encodeURIComponent(key)}` +
      `&m=JSON&tu=C&su=m/s`;
    const res = await fetch(url, {
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { obs: null, stationName: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    let data: {
      stationName?: string;
      dateTime?: string;
      wind?: { speed?: number; gust?: number; direction?: number };
      temperature?: number;
      error?: string;
    };
    try {
      data = JSON.parse(text);
    } catch {
      // Auth and quota errors arrive as plain text, not JSON.
      return { obs: null, stationName: null, error: text.slice(0, 120) };
    }
    if (data.error) return { obs: null, stationName: null, error: data.error };
    if (typeof data.wind?.speed !== 'number') {
      return { obs: null, stationName: null, error: 'no wind data in response' };
    }
    return {
      obs: {
        avgWind: data.wind.speed,
        gust: data.wind.gust ?? 0,
        heading: data.wind.direction ?? 0,
        updatedAt: data.dateTime ?? '',
        airTemp: typeof data.temperature === 'number' ? data.temperature : undefined,
        hasWind: true,
      },
      stationName: data.stationName ?? null,
      error: null,
    };
  } catch (e) {
    return {
      obs: null,
      stationName: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
