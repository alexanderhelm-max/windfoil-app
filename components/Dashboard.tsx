'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import StationCard from './StationCard';
import WindTimeline from './WindTimeline';
import GoWindow from './GoWindow';
import AlertBanner from './AlertBanner';
import AddStationDialog from './AddStationDialog';
import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory, ForecastPoint, DaylightInfo, ForecastSource } from '@/lib/smhi';
import { getCondition } from '@/lib/wind-utils';
import { Station, DEFAULT_STATIONS } from '@/lib/stations';
import { loadStations, saveStations, resetStations } from '@/lib/station-store';

interface FetchedData {
  current: VivaObservation | null;
  history: SmhiObsHistory | null;
  forecast: ForecastPoint[];
  forecastSource?: ForecastSource | null;
  daylight: DaylightInfo | null;
  /** True when history came from Open-Meteo model rather than SMHI measured obs */
  historyIsModelled?: boolean;
  /** Set when past wind came from an auto-resolved nearby SMHI station */
  obsStation?: { id: number; name: string; distanceKm: number } | null;
  /** Per-source failure reasons from the API (e.g. { forecast: 'timeout after 8000ms' }) */
  diag?: Record<string, string>;
}

function formatRefreshTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildUrl(s: Station): string {
  const params = new URLSearchParams();
  if (s.vivaId != null) params.set('vivaId', String(s.vivaId));
  if (s.smhiObsId != null) params.set('smhiObsId', String(s.smhiObsId));
  params.set('lat', String(s.lat));
  params.set('lon', String(s.lon));
  return `/api/station-data?${params.toString()}`;
}

export default function Dashboard() {
  const [stations, setStations] = useState<Station[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<Record<string, FetchedData>>({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const stationRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    setStations(loadStations());
    setHydrated(true);
  }, []);

  // Fetch data when stations change, refresh every 15 minutes,
  // and re-fetch when the page becomes visible again (iOS home-screen apps
  // suspend timers while backgrounded).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    let lastFetchAt = 0;

    const fetchAll = async (showLoading: boolean) => {
      if (showLoading) setDataLoaded(false);
      lastFetchAt = Date.now();
      const entries = await Promise.all(
        stations.map(async (s) => {
          try {
            const res = await fetch(buildUrl(s));
            if (!res.ok) return [
              s.id,
              { current: null, history: null, forecast: [], daylight: null, historyIsModelled: false },
            ] as const;
            const d = (await res.json()) as FetchedData;
            return [s.id, d] as const;
          } catch {
            return [
              s.id,
              { current: null, history: null, forecast: [], daylight: null, historyIsModelled: false },
            ] as const;
          }
        })
      );
      if (cancelled) return;
      setData(Object.fromEntries(entries));
      setDataLoaded(true);
      setLastRefreshAt(Date.now());
    };

    fetchAll(true);
    const intervalId = setInterval(() => fetchAll(false), 15 * 60 * 1000);

    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Only refetch if data is older than 1 minute — avoids spamming on
      // rapid focus toggles, but ensures fresh data after backgrounding.
      if (Date.now() - lastFetchAt > 60 * 1000) fetchAll(false);
    };
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [stations, hydrated]);

  const updateStations = useCallback((next: Station[]) => {
    saveStations(next);
    setStations(next);
  }, []);

  const handleAdd = useCallback(
    (station: Station) => {
      updateStations([...stations, station]);
    },
    [stations, updateStations]
  );

  const handleRemove = useCallback(
    (id: string) => {
      updateStations(stations.filter((s) => s.id !== id));
      if (selectedStationId === id) setSelectedStationId(null);
    },
    [stations, updateStations, selectedStationId]
  );

  const handleReset = useCallback(() => {
    if (!confirm('Reset to default stations? Your custom list will be lost.')) return;
    const defaults = resetStations();
    setStations([...defaults]);
    setSelectedStationId(null);
  }, []);

  const handleSelectStation = (stationId: string) => {
    if (selectedStationId === stationId) {
      setSelectedStationId(null);
      return;
    }
    setSelectedStationId(stationId);
  };

  // When a station is selected (from card click or from GoWindow ranking),
  // smooth-scroll the bottom timeline section into view so the user doesn't
  // have to hunt for it.
  useEffect(() => {
    if (!selectedStationId) return;
    const id = window.setTimeout(() => {
      timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [selectedStationId]);

  const handleSelectFromRanking = useCallback((stationId: string) => {
    setSelectedStationId(stationId);
  }, []);

  // Build effectiveStations: synthesize current from forecast for stations with no live data
  const effectiveStations = stations.map((s) => {
    const d = data[s.id];
    const recentObs =
      d?.history?.windSpeed.slice(-3).map((p) => ({ time: p.time, wind: p.value })) ?? [];
    let current = d?.current ?? null;
    let airTempIsForecast = false;
    let windIsForecast = false;
    if (!current && d?.forecast && d.forecast.length > 0) {
      const nearest = d.forecast[0];
      current = {
        avgWind: nearest.windSpeed,
        gust: nearest.gust,
        heading: nearest.windDir,
        updatedAt: nearest.time,
        airTemp: nearest.airTemp,
        hasWind: true,
      };
      airTempIsForecast = nearest.airTemp !== undefined;
      windIsForecast = true;
    } else if (current && d?.forecast && d.forecast.length > 0) {
      // VIVA station with partial data — fill missing wind from forecast, missing air temp too
      const nearest = d.forecast[0];
      const next: VivaObservation = { ...current };
      if (!current.hasWind) {
        next.avgWind = nearest.windSpeed;
        next.gust = nearest.gust;
        next.heading = nearest.windDir;
        next.updatedAt = nearest.time; // honest freshness: wind is from current forecast
        windIsForecast = true;
      }
      if (current.airTemp === undefined) {
        next.airTemp = nearest.airTemp;
        airTempIsForecast = nearest.airTemp !== undefined;
      }
      current = next;
    }
    return {
      station: s,
      current,
      history: d?.history ?? null,
      historyIsModelled: d?.historyIsModelled ?? false,
      obsStation: d?.obsStation ?? null,
      forecast: d?.forecast ?? [],
      daylight: d?.daylight ?? null,
      recentObs,
      airTempIsForecast,
      windIsForecast,
    };
  });

  const selectedEntry = effectiveStations.find((e) => e.station.id === selectedStationId) ?? null;

  const greatStations = effectiveStations
    .filter((e) => {
      if (!e.current) return false;
      const condition = getCondition(e.current.avgWind, e.current.heading);
      return condition === 'great' || condition === 'crazy';
    })
    .map((e) => ({
      name: e.station.name,
      condition: getCondition(e.current!.avgWind, e.current!.heading) as 'great' | 'crazy',
      avgWind: e.current!.avgWind,
    }));

  const stationForecasts = effectiveStations.map((e) => ({
    stationId: e.station.id,
    stationName: e.station.name,
    current: e.current,
    forecast: e.forecast,
  }));

  // Surface forecast status:
  //   - outage: all forecasts empty AND at least one error → both providers down
  //   - fallback: forecasts populated but coming from SMHI (Open-Meteo down, SMHI saved us)
  const stationsWithData = stations.filter((s) => data[s.id]);
  const forecastErrors = stationsWithData
    .map((s) => data[s.id]?.diag?.forecast)
    .filter((e): e is string => !!e);
  const allForecastsEmpty =
    stationsWithData.length > 0 &&
    stationsWithData.every((s) => (data[s.id]?.forecast?.length ?? 0) === 0);
  const forecastOutage =
    dataLoaded && allForecastsEmpty && forecastErrors.length > 0 ? forecastErrors[0] : null;
  const usingSmhiFallback =
    dataLoaded &&
    !forecastOutage &&
    stationsWithData.some((s) => data[s.id]?.forecastSource === 'smhi');

  const existingIds = new Set(stations.map((s) => s.id));
  const isDefault =
    stations.length === DEFAULT_STATIONS.length &&
    stations.every((s, i) => s.id === DEFAULT_STATIONS[i].id);

  if (!hydrated) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-slate-400 text-sm">Loading stations...</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-slate-200">Stations</h2>
          {lastRefreshAt && (
            <span className="text-xs text-slate-500 tabular-nums" title="Time of last data refresh">
              Last refresh {formatRefreshTime(lastRefreshAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isDefault && (
            <button
              onClick={handleReset}
              className="text-xs text-slate-400 hover:text-slate-200 hover:underline"
            >
              Reset to defaults
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition"
          >
            + Add station
          </button>
        </div>
      </div>

      {forecastOutage && (
        <div className="bg-amber-900/30 border border-amber-700/60 rounded-xl px-4 py-3 mb-4 text-sm text-amber-200">
          <span className="font-semibold">Forecast unavailable.</span> Both Open-Meteo and the
          SMHI fallback failed ({forecastOutage}), so the Plan-ahead rankings and forecast-only
          stations (e.g. Marstrand, Lysekil) have no data. Live conditions from VIVA stations are
          unaffected.
        </div>
      )}
      {usingSmhiFallback && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-2 mb-4 text-xs text-slate-400">
          Open-Meteo is unreachable — showing SMHI metfcst forecast instead.
        </div>
      )}

      <AlertBanner greatStations={greatStations} />

      {dataLoaded && (
        <GoWindow stationForecasts={stationForecasts} onStationSelect={handleSelectFromRanking} />
      )}
      {!dataLoaded && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6 text-slate-400 text-sm">
          Loading station data...
        </div>
      )}

      {stations.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-400">
          <p className="mb-3">No stations yet.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md"
          >
            + Add your first station
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {effectiveStations.map((e) => (
            <div
              key={e.station.id}
              ref={(el) => {
                stationRefs.current[e.station.id] = el;
              }}
              className="scroll-mt-20"
            >
              <StationCard
                id={e.station.id}
                name={e.station.name}
                description={e.station.description}
                current={e.current}
                history={e.history}
                recentObs={e.recentObs}
                isSelected={selectedStationId === e.station.id}
                onClick={() => handleSelectStation(e.station.id)}
                onRemove={handleRemove}
                airTempIsForecast={e.airTempIsForecast}
                windIsForecast={e.windIsForecast}
                daylight={e.daylight}
              />
            </div>
          ))}
        </div>
      )}

      <section ref={timelineRef} className="scroll-mt-20">
        <h2 className="text-xl font-bold text-slate-200 mb-2">Wind Timeline</h2>
        {!selectedEntry && (
          <p className="text-slate-500 text-sm mb-4">
            Click a station card above to see its 24h history and 96h forecast.
          </p>
        )}
        {selectedEntry && (
          <WindTimeline
            stationName={selectedEntry.station.name}
            history={selectedEntry.history}
            forecast={selectedEntry.forecast}
            historyIsModelled={selectedEntry.historyIsModelled}
            obsStation={selectedEntry.obsStation}
          />
        )}
      </section>

      {showAdd && (
        <AddStationDialog
          existingIds={existingIds}
          onAdd={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
