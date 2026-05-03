'use client';

import { useState, useEffect, useCallback } from 'react';
import StationCard from './StationCard';
import WindTimeline from './WindTimeline';
import GoWindow from './GoWindow';
import AlertBanner from './AlertBanner';
import AddStationDialog from './AddStationDialog';
import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory, ForecastPoint, DaylightInfo } from '@/lib/smhi';
import { getCondition } from '@/lib/wind-utils';
import { Station, DEFAULT_STATIONS } from '@/lib/stations';
import { loadStations, saveStations, resetStations } from '@/lib/station-store';

interface FetchedData {
  current: VivaObservation | null;
  history: SmhiObsHistory | null;
  forecast: ForecastPoint[];
  daylight: DaylightInfo | null;
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

  // Hydrate from localStorage
  useEffect(() => {
    setStations(loadStations());
    setHydrated(true);
  }, []);

  // Fetch data when stations change
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setDataLoaded(false);
    (async () => {
      const entries = await Promise.all(
        stations.map(async (s) => {
          try {
            const res = await fetch(buildUrl(s));
            if (!res.ok) return [s.id, { current: null, history: null, forecast: [], daylight: null }] as const;
            const d = (await res.json()) as FetchedData;
            return [s.id, d] as const;
          } catch {
            return [s.id, { current: null, history: null, forecast: [], daylight: null }] as const;
          }
        })
      );
      if (cancelled) return;
      setData(Object.fromEntries(entries));
      setDataLoaded(true);
    })();
    return () => {
      cancelled = true;
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

  // Build effectiveStations: synthesize current from forecast for stations with no live data
  const effectiveStations = stations.map((s) => {
    const d = data[s.id];
    const recentObs =
      d?.history?.windSpeed.slice(-3).map((p) => ({ time: p.time, wind: p.value })) ?? [];
    let current = d?.current ?? null;
    let airTempIsForecast = false;
    if (!current && d?.forecast && d.forecast.length > 0) {
      const nearest = d.forecast[0];
      current = {
        avgWind: nearest.windSpeed,
        gust: nearest.gust,
        heading: nearest.windDir,
        updatedAt: nearest.time,
        airTemp: nearest.airTemp,
      };
      airTempIsForecast = nearest.airTemp !== undefined;
    } else if (current && current.airTemp === undefined && d?.forecast && d.forecast.length > 0) {
      // Live wind data but station has no air-temp sensor — fall back to forecast value
      current = { ...current, airTemp: d.forecast[0].airTemp };
      airTempIsForecast = d.forecast[0].airTemp !== undefined;
    }
    return {
      station: s,
      current,
      history: d?.history ?? null,
      forecast: d?.forecast ?? [],
      daylight: d?.daylight ?? null,
      recentObs,
      airTempIsForecast,
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
        <h2 className="text-xl font-bold text-slate-200">Stations</h2>
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

      <AlertBanner greatStations={greatStations} />

      {dataLoaded && <GoWindow stationForecasts={stationForecasts} />}
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
            <StationCard
              key={e.station.id}
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
              daylight={e.daylight}
            />
          ))}
        </div>
      )}

      <section>
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
