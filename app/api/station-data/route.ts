import { NextRequest, NextResponse } from 'next/server';
import { fetchVivaStation } from '@/lib/viva';
import {
  fetchSmhiHistory,
  fetchSmhiForecast,
  fetchDaylight,
  fetchOpenMeteoHistory,
  SmhiObsHistory,
} from '@/lib/smhi';

function isEmptyHistory(h: SmhiObsHistory | null): boolean {
  if (!h) return true;
  return h.windSpeed.length === 0 && h.gust.length === 0;
}

/**
 * Some SMHI obs stations return points but the newest one is hours old
 * (station reporting gap, or we've paired a nearby station whose data doesn't
 * refresh often). Treat "stale" the same as empty so the chart's "Now" view
 * (which only shows the last ~2h) isn't left blank.
 */
function isStaleHistory(h: SmhiObsHistory | null, maxAgeMin = 90): boolean {
  if (!h) return true;
  const newest = Math.max(
    h.windSpeed[h.windSpeed.length - 1]?.time ?? 0,
    h.gust[h.gust.length - 1]?.time ?? 0
  );
  if (newest === 0) return true;
  return Date.now() - newest > maxAgeMin * 60 * 1000;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vivaId = sp.get('vivaId');
  const smhiObsId = sp.get('smhiObsId');
  const lat = sp.get('lat');
  const lon = sp.get('lon');

  const [current, smhiHistory, forecastRes, daylight] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon
      ? fetchSmhiForecast(Number(lat), Number(lon))
      : Promise.resolve({ points: [], error: null, source: null as null }),
    lat && lon ? fetchDaylight(Number(lat), Number(lon)) : Promise.resolve(null),
  ]);

  const forecast = forecastRes.points;
  const forecastSource = forecastRes.source;
  const diag: Record<string, string> = {};
  if (forecastRes.error) diag.forecast = forecastRes.error;

  // Fall back to Open-Meteo "model history" if SMHI has nothing, OR if the newest
  // SMHI point is too stale to be useful in the chart's zoomed-in views.
  let history: SmhiObsHistory | null = smhiHistory;
  let historyIsModelled = false;
  if ((isEmptyHistory(smhiHistory) || isStaleHistory(smhiHistory)) && lat && lon) {
    const om = await fetchOpenMeteoHistory(Number(lat), Number(lon));
    if (om.history) {
      history = om.history;
      historyIsModelled = true;
    }
    if (om.error) diag.history = om.error;
  }

  // Anchor the chart at NOW using VIVA's live observation — the freshest real
  // data we have. Without this the obs line ends at the last hourly bucket
  // (often 15–60 min old) and there's a visible gap up to the "NOW" marker.
  if (current?.hasWind && history) {
    const nowTs = new Date(current.updatedAt).getTime();
    if (!isNaN(nowTs)) {
      // Guard against duplicating an existing point at the same second.
      const lastSpeedTs = history.windSpeed[history.windSpeed.length - 1]?.time ?? 0;
      if (nowTs > lastSpeedTs) {
        history.windSpeed.push({ time: nowTs, value: current.avgWind });
        if (current.gust > 0) history.gust.push({ time: nowTs, value: current.gust });
        if (typeof current.heading === 'number') {
          history.windDir.push({ time: nowTs, value: current.heading });
        }
      }
    }
  }

  if (Object.keys(diag).length > 0) {
    console.error('[station-data] open-meteo failure', { lat, lon, diag });
  }

  return NextResponse.json(
    { current, history, forecast, forecastSource, daylight, historyIsModelled, diag },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
