import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVivaStation,
  fetchVivaHistory,
  findNearestVivaStations,
  getVivaStationInfo,
  VivaObservation,
} from '@/lib/viva';
import { fetchHolfuyStation } from '@/lib/holfuy';
import { fetchMarine } from '@/lib/marine';
import {
  fetchSmhiHistory,
  fetchSmhiForecast,
  fetchSmhiMetfcstForecast,
  fetchOpenMeteoHistory,
  findNearestObsStation,
  getObsStationInfo,
  SmhiObsHistory,
  ObsStationRef,
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
  const holfuyId = sp.get('holfuyId');
  // Sheltered spots skip the wave fetch: a model would answer with the nearest
  // open-sea cell, which isn't the water at the launch.
  const sheltered = sp.get('sheltered') === '1';
  const lat = sp.get('lat');
  const lon = sp.get('lon');

  const [vivaCurrent, smhiHistory, forecastRes, smhiFctRes, marineRes] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon
      ? fetchSmhiForecast(Number(lat), Number(lon))
      : Promise.resolve({ points: [], error: null, source: null as null }),
    lat && lon
      ? fetchSmhiMetfcstForecast(Number(lat), Number(lon))
      : Promise.resolve({ points: [], error: null }),
    lat && lon && !sheltered
      ? fetchMarine(Number(lat), Number(lon))
      : Promise.resolve({ now: null, error: null }),
  ]);

  let current: VivaObservation | null = vivaCurrent;
  const forecast = forecastRes.points;
  const forecastSource = forecastRes.source;
  // Second forecast opinion for the chart. When the primary already fell back
  // to SMHI (Open-Meteo down), the second source would duplicate it — omit.
  const forecastSmhi = forecastRes.source === 'open-meteo' ? smhiFctRes.points : [];
  const marine = marineRes.now;
  const diag: Record<string, string> = {};
  if (forecastRes.error) diag.forecast = forecastRes.error;
  if (marineRes.error) diag.marine = marineRes.error;

  const isUsable = (h: SmhiObsHistory | null) => !isEmptyHistory(h) && !isStaleHistory(h);

  // Resolve the live reading first, preferring real measurements over forecast:
  //   1. the spot's own VIVA station (freshest — updates every 5–15 min)
  //   2. the spot's own Holfuy station (spot-mounted, 1-min updates)
  //   3. the nearest VIVA station that actually reports wind
  //   4. (after history resolves below) the newest measured history point
  //   5. nothing — the client then derives a reading from the forecast
  // Track which VIVA station supplied the wind: it is also the preferred
  // history source, since VIVA serves 24h series at 10-minute resolution.
  let currentStation: { name: string; distanceKm: number } | null = null;
  let liveVivaId: number | null = current?.hasWind && vivaId ? Number(vivaId) : null;

  if (!current?.hasWind && holfuyId) {
    const h = await fetchHolfuyStation(Number(holfuyId));
    if (h.obs) {
      // Keep locally measured temps from the spot's own VIVA station if any.
      current = {
        ...h.obs,
        waterTemp: current?.waterTemp,
        airTemp: current?.airTemp ?? h.obs.airTemp,
      };
      currentStation = { name: `Holfuy ${h.stationName ?? `#${holfuyId}`}`, distanceKm: 0 };
    } else if (h.error) {
      diag.holfuy = h.error;
    }
  }

  if (!current?.hasWind && lat && lon) {
    const candidates = (await findNearestVivaStations(Number(lat), Number(lon), 5)).filter(
      (c) => c.id !== Number(vivaId)
    );
    // Probe candidates together rather than in sequence: most VIVA stations
    // carry only water level or temperature, so several misses before a hit is
    // the normal case and doing it serially would stack up round-trips.
    const observations = await Promise.all(candidates.map((c) => fetchVivaStation(c.id)));
    // Candidates are distance-sorted, so the first hit is the closest with wind.
    const hit = candidates.findIndex((_, i) => observations[i]?.hasWind);
    if (hit !== -1) {
      const obs = observations[hit] as VivaObservation;
      // Keep any sensor readings the spot's own station did provide —
      // those are genuinely local — and only borrow the wind.
      current = {
        ...obs,
        waterTemp: current?.waterTemp ?? obs.waterTemp,
        airTemp: current?.airTemp ?? obs.airTemp,
      };
      currentStation = { name: candidates[hit].name, distanceKm: candidates[hit].distanceKm };
      liveVivaId = candidates[hit].id;
    }
  }

  // Resolve past wind, preferring real measurements over model output:
  //   1. VIVA history from the station supplying the live wind (10-min resolution)
  //   2. the explicitly configured SMHI station, if it has fresh data (hourly)
  //   3. the nearest active SMHI wind station, if it has fresh data
  //   4. Open-Meteo model history (clearly labelled as modelled in the UI)
  let history: SmhiObsHistory | null = null;
  let historyIsModelled = false;
  let obsStation: (ObsStationRef & { provider: 'viva' | 'smhi' }) | null = null;

  if (liveVivaId != null) {
    const vh = await fetchVivaHistory(liveVivaId);
    if (isUsable(vh)) {
      history = vh;
      if (lat && lon) {
        const info = await getVivaStationInfo(liveVivaId, Number(lat), Number(lon));
        if (info) obsStation = { ...info, provider: 'viva' };
      }
    }
  }

  if (!isUsable(history) && isUsable(smhiHistory)) {
    history = smhiHistory;
    if (smhiObsId && lat && lon) {
      const info = await getObsStationInfo(Number(smhiObsId), Number(lat), Number(lon));
      if (info) obsStation = { ...info, provider: 'smhi' };
    }
  }

  if (!isUsable(history) && lat && lon) {
    const nearest = await findNearestObsStation(Number(lat), Number(lon));
    // Skip if it resolves to the station we already tried and found unusable.
    if (nearest && nearest.id !== Number(smhiObsId)) {
      const nearestHistory = await fetchSmhiHistory(nearest.id);
      if (isUsable(nearestHistory)) {
        history = nearestHistory;
        obsStation = { ...nearest, provider: 'smhi' };
      }
    }
  }

  if (!isUsable(history) && lat && lon) {
    const om = await fetchOpenMeteoHistory(Number(lat), Number(lon));
    if (om.history) {
      history = om.history;
      historyIsModelled = true;
      obsStation = null;
    }
    if (om.error) diag.history = om.error;
  }

  // Still no live wind, but the chart is backed by real measurements? Use their
  // newest point rather than falling through to forecast — a measurement from a
  // nearby station beats a model value for the spot itself.
  if (!current?.hasWind && history && !historyIsModelled) {
    const lastSpeed = history.windSpeed[history.windSpeed.length - 1];
    const lastGust = history.gust[history.gust.length - 1];
    const lastDir = history.windDir[history.windDir.length - 1];
    if (lastSpeed) {
      const measured: VivaObservation = {
        avgWind: lastSpeed.value,
        gust: lastGust?.value ?? 0,
        heading: lastDir?.value ?? 0,
        updatedAt: new Date(lastSpeed.time).toISOString(),
        airTemp: current?.airTemp,
        waterTemp: current?.waterTemp,
        hasWind: true,
      };
      current = measured;
      if (!currentStation && obsStation) {
        currentStation = { name: obsStation.name, distanceKm: obsStation.distanceKm };
      }
    }
  }

  // Anchor the chart at NOW using the live observation — the freshest real
  // data we have. Without this the obs line ends at the last hourly bucket
  // (often 15–60 min old) and there's a visible gap up to the "NOW" marker.
  // Anchored at fetch time, NOT at current.updatedAt: VIVA's Updated field is
  // a bare "HH:mm" clock string that Date() can't parse (which used to make
  // this whole block silently no-op), and the reading is at most ~15 min old.
  if (current?.hasWind && history) {
    const nowTs = Date.now();
    const lastSpeedTs = history.windSpeed[history.windSpeed.length - 1]?.time ?? 0;
    if (nowTs > lastSpeedTs) {
      history.windSpeed.push({ time: nowTs, value: current.avgWind });
      if (current.gust > 0) history.gust.push({ time: nowTs, value: current.gust });
      if (typeof current.heading === 'number') {
        history.windDir.push({ time: nowTs, value: current.heading });
      }
    }
  }

  if (Object.keys(diag).length > 0) {
    console.error('[station-data] open-meteo failure', { lat, lon, diag });
  }

  return NextResponse.json(
    {
      current,
      currentStation,
      history,
      forecast,
      forecastSource,
      forecastSmhi,
      marine,
      historyIsModelled,
      obsStation,
      diag,
    },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
