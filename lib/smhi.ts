const OBS_BASE = 'https://opendata-download-metobs.smhi.se/api/version/latest';
const FCT_BASE = 'https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point';

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
    if (!res.ok) return null;
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
  } catch {
    return null;
  }
}

/**
 * Fetch the last `pastHours` of hourly wind data from Open-Meteo, formatted as SmhiObsHistory
 * so it can be plugged into the chart wherever a SMHI obs station isn't paired.
 * This is "model history" not real measurements — adequate for trend visualization.
 */
export async function fetchOpenMeteoHistory(
  lat: number,
  lon: number,
  pastHours = 24
): Promise<SmhiObsHistory | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&past_days=2&forecast_days=1&wind_speed_unit=ms&timezone=Europe%2FStockholm`;
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const speeds: number[] = data.hourly?.wind_speed_10m ?? [];
    const dirs: number[] = data.hourly?.wind_direction_10m ?? [];
    const gusts: number[] = data.hourly?.wind_gusts_10m ?? [];
    const now = Date.now();
    const cutoff = now - pastHours * 3600 * 1000;
    const points = times
      .map((t, i) => ({
        time: new Date(t).getTime(),
        speed: speeds[i],
        dir: dirs[i],
        gust: gusts[i],
      }))
      .filter((p) => p.time >= cutoff && p.time <= now);
    if (points.length === 0) return null;
    return {
      windSpeed: points
        .filter((p) => typeof p.speed === 'number')
        .map((p) => ({ time: p.time, value: p.speed })),
      windDir: points
        .filter((p) => typeof p.dir === 'number')
        .map((p) => ({ time: p.time, value: p.dir })),
      gust: points
        .filter((p) => typeof p.gust === 'number')
        .map((p) => ({ time: p.time, value: p.gust })),
    };
  } catch {
    return null;
  }
}

export async function fetchSmhiForecast(lat: number, lon: number): Promise<ForecastPoint[]> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m` +
      `&forecast_days=4&wind_speed_unit=ms&timezone=Europe%2FStockholm`;
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const speeds: number[] = data.hourly?.wind_speed_10m ?? [];
    const dirs: number[] = data.hourly?.wind_direction_10m ?? [];
    const gusts: number[] = data.hourly?.wind_gusts_10m ?? [];
    const temps: number[] = data.hourly?.temperature_2m ?? [];
    const now = Date.now();
    const cutoff48h = now + 48 * 3600 * 1000;

    const all = times.map((t, i) => ({
      time: new Date(t).toISOString(),
      epoch: new Date(t).getTime(),
      windSpeed: speeds[i] ?? 0,
      windDir: dirs[i] ?? 0,
      gust: gusts[i] ?? 0,
      airTemp: temps[i],
    }));

    // 0–48h: hourly. 48–96h: every 6 hours (00, 06, 12, 18 UTC).
    return all
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
  } catch {
    return [];
  }
}
