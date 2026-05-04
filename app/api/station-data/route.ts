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

  const [current, smhiHistory, forecast, daylight] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon ? fetchSmhiForecast(Number(lat), Number(lon)) : Promise.resolve([]),
    lat && lon ? fetchDaylight(Number(lat), Number(lon)) : Promise.resolve(null),
  ]);

  // Fall back to Open-Meteo "model history" for stations with no SMHI obs paired
  // (or where SMHI returned nothing usable). Better than an empty chart.
  let history: SmhiObsHistory | null = smhiHistory;
  let historyIsModelled = false;
  if (isEmptyHistory(smhiHistory) && lat && lon) {
    const om = await fetchOpenMeteoHistory(Number(lat), Number(lon));
    if (om) {
      history = om;
      historyIsModelled = true;
    }
  }

  return NextResponse.json(
    { current, history, forecast, daylight, historyIsModelled },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
