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

  // Fall back to Open-Meteo "model history" for stations with no SMHI obs paired
  // (or where SMHI returned nothing usable). Better than an empty chart.
  let history: SmhiObsHistory | null = smhiHistory;
  let historyIsModelled = false;
  if (isEmptyHistory(smhiHistory) && lat && lon) {
    const om = await fetchOpenMeteoHistory(Number(lat), Number(lon));
    if (om.history) {
      history = om.history;
      historyIsModelled = true;
    }
    if (om.error) diag.history = om.error;
  }

  if (Object.keys(diag).length > 0) {
    console.error('[station-data] open-meteo failure', { lat, lon, diag });
  }

  return NextResponse.json(
    { current, history, forecast, forecastSource, daylight, historyIsModelled, diag },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
