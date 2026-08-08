import { NextRequest, NextResponse } from 'next/server';
import { fetchVivaStation, findNearestVivaStations, VivaObservation } from '@/lib/viva';
import {
  fetchSmhiHistory,
  fetchSmhiForecast,
  fetchDaylight,
  fetchOpenMeteoHistory,
  findNearestObsStation,
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
  const lat = sp.get('lat');
  const lon = sp.get('lon');

  const [vivaCurrent, smhiHistory, forecastRes, daylight] = await Promise.all([
    vivaId ? fetchVivaStation(Number(vivaId)) : Promise.resolve(null),
    smhiObsId ? fetchSmhiHistory(Number(smhiObsId)) : Promise.resolve(null),
    lat && lon
      ? fetchSmhiForecast(Number(lat), Number(lon))
      : Promise.resolve({ points: [], error: null, source: null as null }),
    lat && lon ? fetchDaylight(Number(lat), Number(lon)) : Promise.resolve(null),
  ]);

  let current: VivaObservation | null = vivaCurrent;
  const forecast = forecastRes.points;
  const forecastSource = forecastRes.source;
  const diag: Record<string, string> = {};
  if (forecastRes.error) diag.forecast = forecastRes.error;

  // Resolve past wind, preferring real measurements over model output:
  //   1. the explicitly configured SMHI station, if it has fresh data
  //   2. the nearest active SMHI wind station, if it has fresh data
  //   3. Open-Meteo model history (clearly labelled as modelled in the UI)
  const isUsable = (h: SmhiObsHistory | null) => !isEmptyHistory(h) && !isStaleHistory(h);

  let history: SmhiObsHistory | null = smhiHistory;
  let historyIsModelled = false;
  let obsStation: ObsStationRef | null = null;

  if (!isUsable(history) && lat && lon) {
    const nearest = await findNearestObsStation(Number(lat), Number(lon));
    // Skip if it resolves to the station we already tried and found unusable.
    if (nearest && nearest.id !== Number(smhiObsId)) {
      const nearestHistory = await fetchSmhiHistory(nearest.id);
      if (isUsable(nearestHistory)) {
        history = nearestHistory;
        obsStation = nearest;
      }
    }
  }

  if (!isUsable(history) && lat && lon) {
    const om = await fetchOpenMeteoHistory(Number(lat), Number(lon));
    if (om.history) {
      history = om.history;
      historyIsModelled = true;
    }
    if (om.error) diag.history = om.error;
  }

  // Resolve the live reading, preferring real measurements over forecast:
  //   1. the spot's own VIVA station (freshest — updates every 5–15 min)
  //   2. the nearest VIVA station that actually reports wind
  //   3. the latest point of the measured history resolved above
  //   4. nothing — the client then derives a reading from the forecast
  let currentStation: { name: string; distanceKm: number } | null = null;

  if (!current?.hasWind && lat && lon) {
    const candidates = await findNearestVivaStations(Number(lat), Number(lon));
    for (const c of candidates) {
      if (c.id === Number(vivaId)) continue;
      const obs = await fetchVivaStation(c.id);
      if (obs?.hasWind) {
        // Keep any sensor readings the spot's own station did provide —
        // those are genuinely local — and only borrow the wind.
        current = {
          ...obs,
          waterTemp: current?.waterTemp ?? obs.waterTemp,
          airTemp: current?.airTemp ?? obs.airTemp,
        };
        currentStation = { name: c.name, distanceKm: c.distanceKm };
        break;
      }
    }
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
    {
      current,
      currentStation,
      history,
      forecast,
      forecastSource,
      daylight,
      historyIsModelled,
      obsStation,
      diag,
    },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
  );
}
