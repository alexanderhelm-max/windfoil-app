import { NextRequest, NextResponse } from 'next/server';
import { fetchVivaStation } from '@/lib/viva';
import { fetchSmhiHistory, fetchSmhiForecast, fetchDaylight } from '@/lib/smhi';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vivaId = sp.get('vivaId');
  const smhiObsId = sp.get('smhiObsId');
  const lat = sp.get('lat');
  const lon = sp.get('lon');

  const [current, history, forecast, daylight] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon ? fetchSmhiForecast(Number(lat), Number(lon)) : Promise.resolve([]),
    lat && lon ? fetchDaylight(Number(lat), Number(lon)) : Promise.resolve(null),
  ]);

  return NextResponse.json(
    { current, history, forecast, daylight },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
