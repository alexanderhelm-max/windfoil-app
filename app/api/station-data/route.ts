import { NextRequest, NextResponse } from 'next/server';
import { fetchVivaStation } from '@/lib/viva';
import { fetchSmhiHistory, fetchSmhiForecast } from '@/lib/smhi';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vivaId = sp.get('vivaId');
  const smhiObsId = sp.get('smhiObsId');
  const lat = sp.get('lat');
  const lon = sp.get('lon');

  const [current, history, forecast] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon ? fetchSmhiForecast(Number(lat), Number(lon)) : Promise.resolve([]),
  ]);

  return NextResponse.json(
    { current, history, forecast },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
