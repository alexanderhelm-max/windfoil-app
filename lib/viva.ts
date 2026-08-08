import { haversineKm, STATION_MAX_KM } from './geo';
import { VIVA_STATIONS_SNAPSHOT } from './viva-stations.snapshot';
import type { SmhiObsHistory, SmhiObsPoint } from './smhi';

const VIVA_SVC = 'https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc';
const VIVA_BASE = `${VIVA_SVC}/vivastation`;

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

function rankByDistance(
  roster: { id: number; name: string; lat: number; lon: number }[],
  lat: number,
  lon: number,
  limit: number,
  maxKm: number
): VivaStationRef[] {
  return roster
    .map((s) => ({ id: s.id, name: s.name, distanceKm: haversineKm(lat, lon, s.lat, s.lon) }))
    .filter((s) => s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

async function fetchVivaRoster(): Promise<
  { id: number; name: string; lat: number; lon: number }[]
> {
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
      .map((s) => ({ id: s.ID, name: s.Name, lat: s.Lat as number, lon: s.Lon as number }));
  } catch {
    return [];
  }
}

/**
 * VIVA history timestamps are Swedish wall-clock time ("YYYY-MM-DD HH:MM:SS",
 * no timezone marker), while the server runs in UTC — parse them via the
 * Europe/Stockholm offset or every point lands 1–2h off. Offset is memoized
 * per hour; only a DST-transition night can make it vary within one series.
 */
const tzOffsetCache = new Map<number, number>();
function stockholmOffsetMs(atEpoch: number): number {
  const hourKey = Math.floor(atEpoch / 3_600_000);
  const cached = tzOffsetCache.get(hourKey);
  if (cached !== undefined) return cached;
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    timeZoneName: 'longOffset',
  })
    .formatToParts(atEpoch)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offset = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
  tzOffsetCache.set(hourKey, offset);
  return offset;
}

function parseVivaTime(s: string): number {
  const asUtc = Date.parse(s.replace(' ', 'T') + 'Z');
  if (isNaN(asUtc)) return NaN;
  return asUtc - stockholmOffsetMs(asUtc);
}

interface VivaHistoryEntry {
  Value: string;
  Time: string;
}

async function fetchVivaHistoryParam(param: string, id: number): Promise<SmhiObsPoint[]> {
  try {
    const res = await fetch(`${VIVA_SVC}/ViVaStationHistory/${param}/${id}?isMVY=false`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list: VivaHistoryEntry[] = data?.GetHistoryResult?.StationHistory ?? [];
    return list
      .map((e) => ({ time: parseVivaTime(e.Time), value: parseFloat(e.Value) }))
      .filter((p) => !isNaN(p.time) && !isNaN(p.value))
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

/**
 * 24h of measured history from a VIVA station: 144 samples at 10-minute
 * resolution per parameter — six times denser than SMHI's hourly obs.
 * Unlike the snapshot's "V 9.1" format, history values are plain numbers;
 * direction comes as its own series in degrees. Empty arrays for parameters
 * the station doesn't carry — callers judge usability, same as SMHI history.
 */
export async function fetchVivaHistory(id: number): Promise<SmhiObsHistory> {
  const [windSpeed, gust, windDir] = await Promise.all([
    fetchVivaHistoryParam('Medelvind', id),
    fetchVivaHistoryParam('Byvind', id),
    fetchVivaHistoryParam('Vindriktning', id),
  ]);
  return { windSpeed, windDir, gust };
}

/**
 * Name + distance for a known VIVA station id, for source attribution in the
 * UI. Roster is live-first with the committed snapshot as fallback.
 */
export async function getVivaStationInfo(
  id: number,
  lat: number,
  lon: number
): Promise<VivaStationRef | null> {
  const live = await fetchVivaRoster();
  const roster = live.length > 0 ? live : VIVA_STATIONS_SNAPSHOT;
  const s = roster.find((x) => x.id === id);
  if (!s) return null;
  return { id, name: s.name, distanceKm: haversineKm(lat, lon, s.lat, s.lon) };
}

/**
 * Nearest VIVA stations to a point, closest first.
 *
 * Returns several candidates rather than one because many VIVA stations carry
 * only water level or temperature sensors — the caller has to fetch a station
 * to discover whether it reports wind, and falls through to the next if not.
 *
 * Uses VIVA's live roster (cached for a day), falling back to the committed
 * snapshot in lib/viva-stations.snapshot.ts when the roster request fails —
 * so nearest-station resolution keeps working through VIVA roster outages.
 */
export async function findNearestVivaStations(
  lat: number,
  lon: number,
  limit = 3,
  maxKm = STATION_MAX_KM
): Promise<VivaStationRef[]> {
  const live = await fetchVivaRoster();
  const roster = live.length > 0 ? live : VIVA_STATIONS_SNAPSHOT;
  return rankByDistance(roster, lat, lon, limit, maxKm);
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
