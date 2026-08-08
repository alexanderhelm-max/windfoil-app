import { haversineKm, STATION_MAX_KM } from './geo';

const VIVA_BASE = 'https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc/vivastation';

interface VivaSample {
  Name: string;
  Value: string;
  Heading: number;
  Unit: string;
  Type: string;
  Updated: string;
  Quality: string;
}

// Value format is "V 3.6" or "SV 7.5" — last space-separated token is the number
function parseVivaValue(str: string): number {
  if (!str) return 0;
  const parts = str.trim().split(' ');
  return parseFloat(parts[parts.length - 1]) || 0;
}

export interface VivaObservation {
  avgWind: number;
  gust: number;
  heading: number;
  updatedAt: string;
  waterTemp?: number;
  airTemp?: number;
  /** False when this VIVA station does not have a wind sensor (e.g. Varberg).
   *  Wind fields are zero in that case and Dashboard fills them from forecast. */
  hasWind: boolean;
}

export interface VivaStationRef {
  id: number;
  name: string;
  distanceKm: number;
}

interface VivaStationListRaw {
  ID: number;
  Name: string;
  Lat?: number;
  Lon?: number;
}

/**
 * Nearest VIVA stations to a point, closest first.
 *
 * Returns several candidates rather than one because many VIVA stations carry
 * only water level or temperature sensors — the caller has to fetch a station
 * to discover whether it reports wind, and falls through to the next if not.
 *
 * Best-effort: VIVA's roster does not always carry coordinates, and stations
 * without them are skipped. An empty result just means the caller uses its
 * next-best source.
 */
export async function findNearestVivaStations(
  lat: number,
  lon: number,
  limit = 3,
  maxKm = STATION_MAX_KM
): Promise<VivaStationRef[]> {
  try {
    // Trailing slash AND Accept: application/json are both required; without
    // them the WCF service returns an HTML help page instead of JSON.
    const res = await fetch(`${VIVA_BASE}/`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list: VivaStationListRaw[] = data?.GetStationsResult?.Stations ?? [];
    return list
      .filter((s) => typeof s.Lat === 'number' && typeof s.Lon === 'number')
      .map((s) => ({
        id: s.ID,
        name: s.Name,
        distanceKm: haversineKm(lat, lon, s.Lat as number, s.Lon as number),
      }))
      .filter((s) => s.distanceKm <= maxKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchVivaStation(id: number): Promise<VivaObservation | null> {
  try {
    const res = await fetch(`${VIVA_BASE}/${id}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const samples: VivaSample[] = data?.GetSingleStationResult?.Samples ?? [];
    if (samples.length === 0) return null;

    const medelvind = samples.find((s) => s.Name === 'Medelvind');
    const byvind = samples.find((s) => s.Name === 'Byvind');
    // Water temp varies by station: "Vattentemp" (surface), "Vattentemp 3m" (near-surface),
    // "Vattentemp Botten" (bottom — skip, not surface relevant)
    const vattentemp =
      samples.find((s) => s.Name === 'Vattentemp') ??
      samples.find((s) => s.Name === 'Vattentemp 3m') ??
      samples.find((s) => /^Vattentemp(?!.*Botten)/.test(s.Name));
    const lufttemp = samples.find((s) => s.Name === 'Lufttemp');

    const hasWind = !!(medelvind || byvind);
    const ref = medelvind ?? byvind ?? vattentemp ?? lufttemp ?? samples[0];

    // Return data as long as ANY useful sample exists (some stations measure only water level/temp).
    // Wind-less stations get hasWind=false; Dashboard fills wind from forecast.
    if (!hasWind && !vattentemp && !lufttemp) return null;

    return {
      avgWind: medelvind ? parseVivaValue(medelvind.Value) : 0,
      gust: byvind ? parseVivaValue(byvind.Value) : 0,
      heading: ref.Heading,
      updatedAt: ref.Updated,
      waterTemp: vattentemp ? parseFloat(vattentemp.Value) : undefined,
      airTemp: lufttemp ? parseFloat(lufttemp.Value) : undefined,
      hasWind,
    };
  } catch {
    return null;
  }
}
