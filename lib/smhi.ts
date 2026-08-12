import { haversineKm, STATION_MAX_KM } from './geo';
import { fetchJsonWithDiag } from './fetch-json';

const OBS_BASE = 'https://opendata-download-metobs.smhi.se/api/version/latest';
// SMHI replaced pmp3g/v2 with snow1g/v1 on 2026-03-31. Nordic-only point forecast.
const FCT_BASE = 'https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point';

export interface SmhiObsPoint {
  time: number; // epoch ms
  value: number;
}

export interface ObsStationRef {
  id: number;
  name: string;
  distanceKm: number;
}

interface SmhiStationRaw {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  active?: boolean;
}

/**
 * Find the closest active SMHI station that measures wind speed (parameter 4).
 *
 * We resolve this from SMHI's own live roster rather than hardcoding station
 * ids: ids we can't verify would silently attribute a different spot's wind to
 * this one, and the roster changes as stations come and go. The list is cached
 * for a day — it rarely changes.
 */
async function fetchObsRoster(): Promise<SmhiStationRaw[]> {
  const { data } = await fetchJsonWithDiag(`${OBS_BASE}/parameter/4.json`, {
    timeoutMs: 8000,
    revalidate: 86400,
  });
  if (!data) return [];
  return (data as { station?: SmhiStationRaw[] }).station ?? [];
}

/**
 * Name + distance for a known SMHI station id, so the UI can attribute
 * measured history to its source even when the station was configured
 * explicitly rather than auto-resolved. Best-effort: null if the roster
 * fetch fails or the id is unknown.
 */
export async function getObsStationInfo(
  id: number,
  lat: number,
  lon: number
): Promise<ObsStationRef | null> {
  const stations = await fetchObsRoster();
  const s = stations.find((st) => Number(st.key) === id);
  if (!s || typeof s.latitude !== 'number' || typeof s.longitude !== 'number') return null;
  return { id, name: s.name, distanceKm: haversineKm(lat, lon, s.latitude, s.longitude) };
}

export async function findNearestObsStation(
  lat: number,
  lon: number,
  maxKm = STATION_MAX_KM
): Promise<ObsStationRef | null> {
  const stations = await fetchObsRoster();
  let best: ObsStationRef | null = null;
  for (const s of stations) {
    if (s.active === false) continue;
    if (typeof s.latitude !== 'number' || typeof s.longitude !== 'number') continue;
    const distanceKm = haversineKm(lat, lon, s.latitude, s.longitude);
    if (distanceKm > maxKm) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { id: Number(s.key), name: s.name, distanceKm };
    }
  }
  return best;
}

async function fetchObsParam(stationId: number, param: number): Promise<SmhiObsPoint[]> {
  try {
    const url = `${OBS_BASE}/parameter/${param}/station/${stationId}/period/latest-day/data.json`;
    const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.value || [])
      .filter((v: { date: number; value: string; quality: string }) => v.quality !== 'R')
      .map((v: { date: number; value: string }) => ({ time: v.date, value: parseFloat(v.value) }))
      .filter((p: { time: number; value: number }) => !isNaN(p.value));
  } catch {
    return [];
  }
}

export interface SmhiObsHistory {
  windSpeed: SmhiObsPoint[];
  windDir: SmhiObsPoint[];
  gust: SmhiObsPoint[];
}

export async function fetchSmhiHistory(stationId: number): Promise<SmhiObsHistory> {
  const [windSpeed, windDir, gust] = await Promise.all([
    fetchObsParam(stationId, 4),
    fetchObsParam(stationId, 3),
    fetchObsParam(stationId, 21),
  ]);
  return { windSpeed, windDir, gust };
}

export interface ForecastPoint {
  time: string; // ISO string
  windSpeed: number;
  windDir: number;
  gust: number;
  airTemp?: number;
}

/**
 * Fetch the last `pastHours` of hourly wind data from Open-Meteo, formatted as SmhiObsHistory
 * so it can be plugged into the chart wherever a SMHI obs station isn't paired.
 * This is "model history" not real measurements — adequate for trend visualization.
 * timezone=GMT so the returned timestamps are UTC and parse to correct epochs on the server.
 */
export async function fetchOpenMeteoHistory(
  lat: number,
  lon: number,
  pastHours = 24
): Promise<{ history: SmhiObsHistory | null; error: string | null }> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&past_days=2&forecast_days=1&wind_speed_unit=ms&timezone=GMT`;
  const { data, error } = await fetchJsonWithDiag(url, { timeoutMs: 8000, revalidate: 1800 });
  if (error || !data) return { history: null, error };
  const hourly = (data as { hourly?: Record<string, unknown> }).hourly ?? {};
  const times: string[] = (hourly.time as string[]) ?? [];
  const speeds: number[] = (hourly.wind_speed_10m as number[]) ?? [];
  const dirs: number[] = (hourly.wind_direction_10m as number[]) ?? [];
  const gusts: number[] = (hourly.wind_gusts_10m as number[]) ?? [];
  const now = Date.now();
  const cutoff = now - pastHours * 3600 * 1000;
  const points = times
    .map((t, i) => ({
      time: new Date(`${t}Z`).getTime(),
      speed: speeds[i],
      dir: dirs[i],
      gust: gusts[i],
    }))
    .filter((p) => p.time >= cutoff && p.time <= now);
  if (points.length === 0) return { history: null, error: 'no data points in range' };
  return {
    history: {
      windSpeed: points
        .filter((p) => typeof p.speed === 'number')
        .map((p) => ({ time: p.time, value: p.speed })),
      windDir: points
        .filter((p) => typeof p.dir === 'number')
        .map((p) => ({ time: p.time, value: p.dir })),
      gust: points
        .filter((p) => typeof p.gust === 'number')
        .map((p) => ({ time: p.time, value: p.gust })),
    },
    error: null,
  };
}

export type ForecastSource = 'open-meteo' | 'smhi';

interface RawHourly {
  epoch: number;
  windSpeed: number;
  windDir: number;
  gust: number;
  airTemp: number | undefined;
}

/** How far back the forecast is kept, matching the 24h observation history. */
const FORECAST_PAST_H = 24;

// -24h–48h: hourly. 48–96h: every 6 hours (00, 06, 12, 18 UTC).
//
// The past hours are kept on purpose. They cost nothing — the provider returns
// them in the same response — and they let the chart run the forecast line
// alongside the measured one over the last day, so you can see how well the
// model has been tracking reality before deciding whether to trust it tonight.
// (It used to trim to strictly-future points, because the chart bridged the
// forecast line from the live NOW anchor and a pre-NOW forecast point would
// have overlapped that fake segment. The bridge is gone; the reason went with
// it, and trimming only left an unexplained hole between the two series.)
function thinAndFormat(all: RawHourly[]): ForecastPoint[] {
  const now = Date.now();
  const cutoff48h = now + 48 * 3600 * 1000;
  const cutoffPast = now - FORECAST_PAST_H * 3600 * 1000;
  return all
    .filter((p) => p.epoch >= cutoffPast)
    .filter((p) => {
      if (p.epoch <= cutoff48h) return true;
      return new Date(p.epoch).getUTCHours() % 6 === 0;
    })
    .map((p) => ({
      time: new Date(p.epoch).toISOString(),
      windSpeed: p.windSpeed,
      windDir: p.windDir,
      gust: p.gust,
      airTemp: p.airTemp,
    }));
}

/**
 * SMHI metfcst (snow1g v1) point forecast. Nordic region only — all our stations are
 * in Sweden so this works as an Open-Meteo fallback. Hourly for ~50h, then 6h out to
 * ~7d, then 12h out to ~11d. URL takes lon BEFORE lat.
 */
interface Snow1gEntry {
  time: string; // ISO Zulu, e.g. "2026-05-26T15:00:00Z"
  data: {
    wind_speed?: number;
    wind_from_direction?: number;
    wind_speed_of_gust?: number;
    air_temperature?: number;
  };
}

export async function fetchSmhiMetfcstForecast(
  lat: number,
  lon: number
): Promise<{ points: ForecastPoint[]; error: string | null }> {
  const url = `${FCT_BASE}/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;
  const { data, error } = await fetchJsonWithDiag(url, { timeoutMs: 8000, revalidate: 3600 });
  if (error || !data) return { points: [], error };
  const series = (data as { timeSeries?: Snow1gEntry[] }).timeSeries ?? [];
  if (series.length === 0) return { points: [], error: 'empty timeSeries' };
  const all: RawHourly[] = series.map((ts) => ({
    epoch: new Date(ts.time).getTime(),
    windSpeed: ts.data.wind_speed ?? 0,
    windDir: ts.data.wind_from_direction ?? 0,
    gust: ts.data.wind_speed_of_gust ?? 0,
    airTemp: ts.data.air_temperature,
  }));
  return { points: thinAndFormat(all), error: null };
}

/**
 * timezone=GMT so returned timestamps are UTC; we append 'Z' and parse to correct epochs
 * regardless of the server's local timezone (Vercel runs in UTC, browsers vary).
 * Falls back to SMHI metfcst when Open-Meteo is unreachable.
 */
export async function fetchSmhiForecast(
  lat: number,
  lon: number
): Promise<{ points: ForecastPoint[]; error: string | null; source: ForecastSource | null }> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m` +
    // past_days=1 so the past window is covered even early in the morning:
    // forecast_days alone starts at today 00:00 and would leave almost nothing
    // behind NOW for the chart to compare against.
    `&forecast_days=4&past_days=1&wind_speed_unit=ms&timezone=GMT`;
  const { data, error } = await fetchJsonWithDiag(url, { timeoutMs: 8000, revalidate: 3600 });
  if (error || !data) {
    const fb = await fetchSmhiMetfcstForecast(lat, lon);
    if (fb.points.length > 0) return { points: fb.points, error: null, source: 'smhi' };
    return {
      points: [],
      error: `open-meteo: ${error ?? 'no data'}; smhi: ${fb.error ?? 'no data'}`,
      source: null,
    };
  }
  const hourly = (data as { hourly?: Record<string, unknown> }).hourly ?? {};
  const times: string[] = (hourly.time as string[]) ?? [];
  const speeds: number[] = (hourly.wind_speed_10m as number[]) ?? [];
  const dirs: number[] = (hourly.wind_direction_10m as number[]) ?? [];
  const gusts: number[] = (hourly.wind_gusts_10m as number[]) ?? [];
  const temps: number[] = (hourly.temperature_2m as number[]) ?? [];
  const all: RawHourly[] = times.map((t, i) => ({
    epoch: new Date(`${t}Z`).getTime(),
    windSpeed: speeds[i] ?? 0,
    windDir: dirs[i] ?? 0,
    gust: gusts[i] ?? 0,
    airTemp: temps[i],
  }));
  return { points: thinAndFormat(all), error: null, source: 'open-meteo' };
}
