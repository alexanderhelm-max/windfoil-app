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
}

export async function fetchSmhiForecast(lat: number, lon: number): Promise<ForecastPoint[]> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&forecast_days=4&wind_speed_unit=ms&timezone=Europe%2FStockholm`;
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const speeds: number[] = data.hourly?.wind_speed_10m ?? [];
    const dirs: number[] = data.hourly?.wind_direction_10m ?? [];
    const gusts: number[] = data.hourly?.wind_gusts_10m ?? [];
    const now = Date.now();
    const cutoff48h = now + 48 * 3600 * 1000;

    const all = times.map((t, i) => ({
      time: new Date(t).toISOString(),
      epoch: new Date(t).getTime(),
      windSpeed: speeds[i] ?? 0,
      windDir: dirs[i] ?? 0,
      gust: gusts[i] ?? 0,
    }));

    // 0–48h: hourly. 48–96h: every 6 hours (00, 06, 12, 18 UTC).
    return all
      .filter((p) => p.epoch >= now)
      .filter((p) => {
        if (p.epoch <= cutoff48h) return true;
        const d = new Date(p.epoch);
        return d.getUTCHours() % 6 === 0;
      })
      .map(({ time, windSpeed, windDir, gust }) => ({ time, windSpeed, windDir, gust }));
  } catch {
    return [];
  }
}
