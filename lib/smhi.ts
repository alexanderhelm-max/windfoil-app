const OBS_BASE = 'https://opendata-download-metobs.smhi.se/api/version/latest';
const FCT_BASE = 'https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point';

/**
 * Fetch JSON with a timeout and one retry on transient failures (timeout, 5xx, 429).
 * Returns the parsed body or a short error string describing why it failed —
 * so callers can surface the real reason instead of silently returning empty.
 */
async function fetchJsonWithDiag(
  url: string,
  opts: { timeoutMs: number; revalidate: number; retries?: number }
): Promise<{ data: unknown | null; error: string | null }> {
  const { timeoutMs, revalidate, retries = 1 } = opts;
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        next: { revalidate },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        // Retry only on rate-limit / server errors; 4xx (other) won't fix on retry.
        if (res.status === 429 || res.status >= 500) continue;
        return { data: null, error: lastError };
      }
      return { data: await res.json(), error: null };
    } catch (e) {
      if (e instanceof Error) {
        lastError = e.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : e.message;
      } else {
        lastError = String(e);
      }
    }
  }
  return { data: null, error: lastError };
}


export interface SmhiObsPoint {
  time: number; // epoch ms
  value: number;
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

export interface DaylightInfo {
  sunrise: string; // ISO local time, e.g. "2026-05-03T05:14"
  sunset: string;
  /** Minutes of daylight remaining from now. 0 if past sunset; full duration if before sunrise. */
  remainingMinutes: number;
  /** True if it's currently between sunrise and sunset. */
  isDay: boolean;
}

export async function fetchDaylight(lat: number, lon: number): Promise<DaylightInfo | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&daily=sunrise,sunset&timezone=Europe%2FStockholm&forecast_days=1`;
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[daylight] open-meteo', lat, lon, `HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const sunrise: string | undefined = data.daily?.sunrise?.[0];
    const sunset: string | undefined = data.daily?.sunset?.[0];
    if (!sunrise || !sunset) return null;
    const now = new Date();
    const sunriseDate = new Date(sunrise);
    const sunsetDate = new Date(sunset);
    const isDay = now >= sunriseDate && now < sunsetDate;
    let remainingMinutes = 0;
    if (now < sunriseDate) {
      remainingMinutes = Math.round((sunsetDate.getTime() - sunriseDate.getTime()) / 60000);
    } else if (isDay) {
      remainingMinutes = Math.round((sunsetDate.getTime() - now.getTime()) / 60000);
    }
    return { sunrise, sunset, remainingMinutes, isDay };
  } catch (e) {
    console.error('[daylight] open-meteo', lat, lon, e instanceof Error ? e.message : String(e));
    return null;
  }
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

/**
 * timezone=GMT so returned timestamps are UTC; we append 'Z' and parse to correct epochs
 * regardless of the server's local timezone (Vercel runs in UTC, browsers vary).
 */
export async function fetchSmhiForecast(
  lat: number,
  lon: number
): Promise<{ points: ForecastPoint[]; error: string | null }> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m` +
    `&forecast_days=4&wind_speed_unit=ms&timezone=GMT`;
  const { data, error } = await fetchJsonWithDiag(url, { timeoutMs: 8000, revalidate: 3600 });
  if (error || !data) return { points: [], error };
  const hourly = (data as { hourly?: Record<string, unknown> }).hourly ?? {};
  const times: string[] = (hourly.time as string[]) ?? [];
  const speeds: number[] = (hourly.wind_speed_10m as number[]) ?? [];
  const dirs: number[] = (hourly.wind_direction_10m as number[]) ?? [];
  const gusts: number[] = (hourly.wind_gusts_10m as number[]) ?? [];
  const temps: number[] = (hourly.temperature_2m as number[]) ?? [];
  const now = Date.now();
  const cutoff48h = now + 48 * 3600 * 1000;

  const all = times.map((t, i) => {
    const epoch = new Date(`${t}Z`).getTime();
    return {
      time: new Date(epoch).toISOString(),
      epoch,
      windSpeed: speeds[i] ?? 0,
      windDir: dirs[i] ?? 0,
      gust: gusts[i] ?? 0,
      airTemp: temps[i],
    };
  });

  // 0–48h: hourly. 48–96h: every 6 hours (00, 06, 12, 18 UTC).
  const points = all
    .filter((p) => p.epoch >= now)
    .filter((p) => {
      if (p.epoch <= cutoff48h) return true;
      const d = new Date(p.epoch);
      return d.getUTCHours() % 6 === 0;
    })
    .map(({ time, windSpeed, windDir, gust, airTemp }) => ({
      time,
      windSpeed,
      windDir,
      gust,
      airTemp,
    }));
  return { points, error: null };
}
