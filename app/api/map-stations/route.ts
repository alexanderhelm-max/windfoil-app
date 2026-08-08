import { NextRequest, NextResponse } from 'next/server';
import { fetchVivaStation } from '@/lib/viva';

const OBS_BASE = 'https://opendata-download-metobs.smhi.se/api/version/latest';

/** Only colour a reading that's recent enough to describe conditions now. */
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Fetching VIVA is one request per station, so the viewport request is capped. */
const MAX_VIVA = 40;

interface SetStation {
  key?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  value?: { date?: number; value?: string }[] | null;
}

/**
 * SMHI's station-set endpoint returns the latest hour for every station in one
 * request — the only reason showing live wind for the whole network is cheap
 * enough to do at all.
 */
async function bulkParam(param: number): Promise<SetStation[]> {
  try {
    const res = await fetch(
      `${OBS_BASE}/parameter/${param}/station-set/all/period/latest-hour/data.json`,
      { next: { revalidate: 600 }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.station ?? []) as SetStation[];
  } catch {
    return [];
  }
}

function latestValue(s: SetStation): { value: number; time: number } | null {
  const last = s.value?.[s.value.length - 1];
  if (!last || last.value == null) return null;
  const value = parseFloat(last.value);
  const time = typeof last.date === 'number' ? last.date : 0;
  if (isNaN(value)) return null;
  return { value, time };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vivaIds = (sp.get('viva') ?? '')
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_VIVA);

  const [speeds, dirs, vivaObs] = await Promise.all([
    bulkParam(4),
    bulkParam(3),
    Promise.all(vivaIds.map((id) => fetchVivaStation(id))),
  ]);

  const dirByKey = new Map<string, number>();
  for (const s of dirs) {
    if (!s.key) continue;
    const v = latestValue(s);
    if (v) dirByKey.set(s.key, v.value);
  }

  const now = Date.now();
  const smhi = speeds
    .map((s) => {
      if (!s.key || typeof s.latitude !== 'number' || typeof s.longitude !== 'number') return null;
      const v = latestValue(s);
      // Keep the station on the map even when its reading is stale or missing;
      // it can still be added as a spot, it just won't carry a colour.
      const fresh = v && v.time > 0 && now - v.time <= MAX_AGE_MS;
      return {
        id: Number(s.key),
        name: s.name ?? `SMHI ${s.key}`,
        lat: s.latitude,
        lon: s.longitude,
        avg: fresh ? v!.value : null,
        dir: fresh ? (dirByKey.get(s.key) ?? null) : null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const viva = vivaIds
    .map((id, i) => {
      const o = vivaObs[i];
      if (!o?.hasWind) return null;
      return { id, avg: o.avgWind, gust: o.gust, dir: o.heading };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return NextResponse.json(
    { smhi, viva },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
  );
}
