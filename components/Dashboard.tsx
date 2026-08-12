'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import SpotCard from './SpotCard';
import WindTimeline from './WindTimeline';
import GoWindow from './GoWindow';
import AlertBanner from './AlertBanner';
import AddSpotDialog from './AddSpotDialog';
import SpotSettingsDialog from './SpotSettingsDialog';
import LogSessionDialog from './LogSessionDialog';
import SessionLog from './SessionLog';
import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory, ForecastPoint, ForecastSource } from '@/lib/smhi';
import { getCondition, getHourTrend, WindSector } from '@/lib/wind-utils';
import { MarineNow } from '@/lib/marine';
import { Session, addSession, loadSessions } from '@/lib/sessions';
import { Spot, DEFAULT_SPOTS } from '@/lib/spots';
import { loadSpots, saveSpots, resetSpots } from '@/lib/spot-store';
import { buildShareSpotsUrl, decodeSpotsFromParam, copyToClipboard } from '@/lib/share';

// Leaflet touches window at import time, so the map can only load client-side.
const WindMap = dynamic(() => import('./WindMap'), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 mb-8 flex items-center justify-center text-slate-500 text-sm" style={{ height: '65vh', minHeight: 380 }}>
      Loading map…
    </div>
  ),
});

const VIEW_KEY = 'windfoil:view:v1';

interface FetchedData {
  current: VivaObservation | null;
  history: SmhiObsHistory | null;
  forecast: ForecastPoint[];
  forecastSource?: ForecastSource | null;
  /** Second forecast opinion (SMHI point forecast) for the chart */
  forecastSmhi?: ForecastPoint[];
  /** True when history came from Open-Meteo model rather than SMHI measured obs */
  historyIsModelled?: boolean;
  /** Source of measured past wind: which provider/station and how far away */
  obsStation?: { id: number; name: string; distanceKm: number; provider?: 'viva' | 'smhi' } | null;
  /** Set when the live reading came from a nearby station rather than this spot's own */
  currentStation?: { name: string; distanceKm: number } | null;
  /** Sea state from the wave model; null for sheltered spots and inland points */
  marine?: MarineNow | null;
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

function buildUrl(s: Spot): string {
  const params = new URLSearchParams();
  if (s.vivaId != null) params.set('vivaId', String(s.vivaId));
  if (s.smhiObsId != null) params.set('smhiObsId', String(s.smhiObsId));
  if (s.holfuyId != null) params.set('holfuyId', String(s.holfuyId));
  if (s.sheltered) params.set('sheltered', '1');
  params.set('lat', String(s.lat));
  params.set('lon', String(s.lon));
  return `/api/spot-data?${params.toString()}`;
}

export default function Dashboard() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<Record<string, FetchedData>>({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSectorsId, setEditingSectorsId] = useState<string | null>(null);
  const [loggingSpotId, setLoggingSpotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [pendingImport, setPendingImport] = useState<Spot[] | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const spotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const skipScrollRef = useRef(false);

  // Hydrate from localStorage, and pick up a shared spot list from the
  // URL (?spots=...) — offered as an import rather than applied silently.
  useEffect(() => {
    const loaded = loadSpots();
    setSpots(loaded);
    setHydrated(true);
    if (localStorage.getItem(VIEW_KEY) === 'map') setView('map');
    setSessions(loadSessions());

    const param = new URLSearchParams(window.location.search).get('spots');
    if (param) {
      const shared = decodeSpotsFromParam(param);
      const existing = new Set(loaded.map((s) => s.id));
      const fresh = shared?.filter((s) => !existing.has(s.id)) ?? [];
      if (fresh.length > 0) setPendingImport(fresh);
      // Strip the param so reloads and copied URLs don't re-trigger the offer.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Fetch data when spots change, refresh every 15 minutes,
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
        spots.map(async (s) => {
          try {
            const res = await fetch(buildUrl(s));
            if (!res.ok) return [
              s.id,
              { current: null, history: null, forecast: [], historyIsModelled: false },
            ] as const;
            const d = (await res.json()) as FetchedData;
            return [s.id, d] as const;
          } catch {
            return [
              s.id,
              { current: null, history: null, forecast: [], historyIsModelled: false },
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
  }, [spots, hydrated]);

  const updateSpots = useCallback((next: Spot[]) => {
    saveSpots(next);
    setSpots(next);
  }, []);

  const handleAdd = useCallback(
    (spot: Spot) => {
      updateSpots([...spots, spot]);
    },
    [spots, updateSpots]
  );

  const handleRemove = useCallback(
    (id: string) => {
      updateSpots(spots.filter((s) => s.id !== id));
      if (selectedSpotId === id) setSelectedSpotId(null);
    },
    [spots, updateSpots, selectedSpotId]
  );

  const handleSaveSettings = useCallback(
    (id: string, settings: { goodSectors: WindSector[]; sheltered: boolean }) => {
      updateSpots(
        spots.map((s) => {
          if (s.id !== id) return s;
          // Drop the keys entirely at their defaults, so "unknown" stays
          // distinguishable from "configured as empty" and shared links and
          // stored lists don't carry noise.
          const { goodSectors: _s, sheltered: _h, ...rest } = s;
          return {
            ...rest,
            ...(settings.goodSectors.length > 0 ? { goodSectors: settings.goodSectors } : {}),
            ...(settings.sheltered ? { sheltered: true } : {}),
          };
        })
      );
    },
    [spots, updateSpots]
  );

  const handleReset = useCallback(() => {
    if (!confirm('Reset to default spots? Your custom list will be lost.')) return;
    const defaults = resetSpots();
    setSpots([...defaults]);
    setSelectedSpotId(null);
  }, []);

  const switchView = useCallback((next: 'list' | 'map') => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }, []);

  const handleShareSpots = useCallback(async () => {
    const url = buildShareSpotsUrl(spots);
    // Native share sheet on mobile; clipboard on desktop.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'My windfoil spots', url });
        return;
      } catch {
        // User cancelled the sheet — fall through to clipboard.
      }
    }
    if (await copyToClipboard(url)) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    }
  }, [spots]);

  const handleImportShared = useCallback(() => {
    if (!pendingImport) return;
    updateSpots([...spots, ...pendingImport]);
    setPendingImport(null);
  }, [pendingImport, spots, updateSpots]);

  const handleSelectSpot = (spotId: string) => {
    if (selectedSpotId === spotId) {
      setSelectedSpotId(null);
      return;
    }
    setSelectedSpotId(spotId);
  };

  // When a spot is selected (from card click or from GoWindow ranking),
  // smooth-scroll the bottom timeline section into view so the user doesn't
  // have to hunt for it.
  useEffect(() => {
    if (!selectedSpotId) return;
    // Selecting from the map only opens the marker popup; scrolling away from
    // the map there would be jarring, so the popup's button scrolls instead.
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [selectedSpotId]);

  const handleMapSelect = useCallback((spotId: string) => {
    skipScrollRef.current = true;
    setSelectedSpotId(spotId);
  }, []);

  const handleMapDeselect = useCallback(() => setSelectedSpotId(null), []);

  const handleOpenTimeline = useCallback((spotId: string) => {
    skipScrollRef.current = false;
    setSelectedSpotId(spotId);
    // Same id as already selected wouldn't re-run the effect above, so scroll here.
    window.setTimeout(() => {
      timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleSelectFromRanking = useCallback((spotId: string) => {
    setSelectedSpotId(spotId);
  }, []);

  // Build effectiveSpots: synthesize current from forecast for spots with no live data
  const effectiveSpots = spots.map((s) => {
    const d = data[s.id];
    // A full hour of readings, so the card's trend is a real one-hour slope
    // rather than whatever the last few samples happened to do.
    const hourAgo = Date.now() - 3600_000;
    const recentObs =
      d?.history?.windSpeed
        .filter((p) => p.time >= hourAgo)
        .map((p) => ({ time: p.time, wind: p.value })) ?? [];
    let current = d?.current ?? null;
    let airTempIsForecast = false;
    let windIsForecast = false;
    // The forecast series now spans the past day as well as the days ahead, so
    // the point standing in for "right now" is the one closest to now — not the
    // first in the array, which is a day old.
    const nearestForecast = d?.forecast?.length
      ? d.forecast.reduce((best, p) =>
          Math.abs(new Date(p.time).getTime() - Date.now()) <
          Math.abs(new Date(best.time).getTime() - Date.now())
            ? p
            : best
        )
      : null;
    if (!current && nearestForecast) {
      const nearest = nearestForecast;
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
    } else if (current && nearestForecast) {
      // VIVA station with partial data — fill missing wind from forecast, missing air temp too
      const nearest = nearestForecast;
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
      spot: s,
      current,
      history: d?.history ?? null,
      historyIsModelled: d?.historyIsModelled ?? false,
      obsStation: d?.obsStation ?? null,
      currentStation: d?.currentStation ?? null,
      forecastSource: d?.forecastSource ?? null,
      forecastSmhi: d?.forecastSmhi ?? [],
      forecast: d?.forecast ?? [],
      // Computed once here and handed to the card, the ranking and the map,
      // so all three describe the same hour the same way.
      trend: getHourTrend(recentObs),
      marine: d?.marine ?? null,
      airTempIsForecast,
      windIsForecast,
    };
  });

  const selectedEntry = effectiveSpots.find((e) => e.spot.id === selectedSpotId) ?? null;

  const greatSpots = effectiveSpots
    .filter((e) => {
      if (!e.current) return false;
      const condition = getCondition(e.current.avgWind, e.current.heading, e.spot.goodSectors);
      return condition === 'great' || condition === 'crazy';
    })
    .map((e) => ({
      name: e.spot.name,
      condition: getCondition(e.current!.avgWind, e.current!.heading, e.spot.goodSectors) as 'great' | 'crazy',
      avgWind: e.current!.avgWind,
    }));

  const spotForecasts = effectiveSpots.map((e) => ({
    spotId: e.spot.id,
    spotName: e.spot.name,
    current: e.current,
    forecast: e.forecast,
    trend: e.trend,
    goodSectors: e.spot.goodSectors,
  }));

  // Surface forecast status:
  //   - outage: all forecasts empty AND at least one error → both providers down
  //   - fallback: forecasts populated but coming from SMHI (Open-Meteo down, SMHI saved us)
  const stationsWithData = spots.filter((s) => data[s.id]);
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

  const existingIds = new Set(spots.map((s) => s.id));
  const isDefault =
    spots.length === DEFAULT_SPOTS.length &&
    spots.every((s, i) => s.id === DEFAULT_SPOTS[i].id);

  if (!hydrated) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-slate-400 text-sm">Loading spots...</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-slate-200">Spots</h2>
          <div className="inline-flex rounded-lg bg-slate-900/60 p-0.5 border border-slate-700 self-center">
            {(['list', 'map'] as const).map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1 text-xs font-medium rounded-md transition capitalize ${
                  view === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
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
            onClick={handleShareSpots}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-md transition"
            title="Share your spot list as a link — recipients get an import prompt."
          >
            {shareCopied ? 'Link copied!' : 'Share spots'}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition"
          >
            + Add spot
          </button>
        </div>
      </div>

      {pendingImport && (
        <div className="bg-blue-900/30 border border-blue-700/60 rounded-xl px-4 py-3 mb-4 text-sm text-blue-200 flex items-center justify-between gap-3 flex-wrap">
          <span>
            <span className="font-semibold">Shared spots:</span>{' '}
            {pendingImport.map((s) => s.name).join(', ')} — add to your list?
          </span>
          <span className="flex gap-2 shrink-0">
            <button
              onClick={handleImportShared}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition"
            >
              Add {pendingImport.length === 1 ? 'it' : `all ${pendingImport.length}`}
            </button>
            <button
              onClick={() => setPendingImport(null)}
              className="px-3 py-1 text-blue-300 hover:text-white text-xs rounded-md transition"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}

      {/* In map view the map is the point of the page — it goes above the
          banners and rankings, which stay available by scrolling. */}
      {view === 'map' && (
        <WindMap
          entries={effectiveSpots.map((e) => ({
            spot: e.spot,
            current: e.current,
            windIsForecast: e.windIsForecast,
            currentStation: e.currentStation,
            trend: e.trend,
            marine: e.marine,
          }))}
          selectedSpotId={selectedSpotId}
          onSelect={handleMapSelect}
          onDeselect={handleMapDeselect}
          onOpenTimeline={handleOpenTimeline}
          onAddSpot={handleAdd}
          existingIds={existingIds}
        />
      )}

      {forecastOutage && (
        <div className="bg-amber-900/30 border border-amber-700/60 rounded-xl px-4 py-3 mb-4 text-sm text-amber-200">
          <span className="font-semibold">Forecast unavailable.</span> Both Open-Meteo and the
          SMHI fallback failed ({forecastOutage}), so the Plan-ahead rankings and forecast-only
          spots (e.g. Marstrand, Lysekil) have no data. Live conditions from VIVA spots are
          unaffected.
        </div>
      )}
      {usingSmhiFallback && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-2 mb-4 text-xs text-slate-400">
          Open-Meteo is unreachable — showing SMHI metfcst forecast instead.
        </div>
      )}

      <AlertBanner greatSpots={greatSpots} />

      {dataLoaded && (
        <GoWindow spotForecasts={spotForecasts} onSpotSelect={handleSelectFromRanking} />
      )}
      {!dataLoaded && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6 text-slate-400 text-sm">
          Loading station data...
        </div>
      )}

      {view === 'list' &&
        (spots.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-400">
          <p className="mb-3">No spots yet.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md"
          >
            + Add your first spot
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {effectiveSpots.map((e) => (
            <div
              key={e.spot.id}
              ref={(el) => {
                spotRefs.current[e.spot.id] = el;
              }}
              className="scroll-mt-20"
            >
              <SpotCard
                id={e.spot.id}
                name={e.spot.name}
                description={e.spot.description}
                current={e.current}
                history={e.history}
                trend={e.trend}
                isSelected={selectedSpotId === e.spot.id}
                onClick={() => handleSelectSpot(e.spot.id)}
                onRemove={handleRemove}
                airTempIsForecast={e.airTempIsForecast}
                windIsForecast={e.windIsForecast}
                currentStation={e.currentStation}
                goodSectors={e.spot.goodSectors}
                marine={e.marine}
                onEditSectors={setEditingSectorsId}
                onLogSession={setLoggingSpotId}
              />
            </div>
          ))}
        </div>
        ))}

      <section ref={timelineRef} className="scroll-mt-20">
        <h2 className="text-xl font-bold text-slate-200 mb-2">Wind Timeline</h2>
        {!selectedEntry && (
          <p className="text-slate-500 text-sm mb-4">
            {view === 'map'
              ? 'Tap a spot on the map to see its 24h history and 96h forecast.'
              : 'Click a spot card above to see its 24h history and 96h forecast.'}
          </p>
        )}
        {selectedEntry && (
          <WindTimeline
            spotName={selectedEntry.spot.name}
            history={selectedEntry.history}
            forecast={selectedEntry.forecast}
            historyIsModelled={selectedEntry.historyIsModelled}
            obsStation={selectedEntry.obsStation}
            forecastSource={selectedEntry.forecastSource}
            forecastSmhi={selectedEntry.forecastSmhi}
            goodSectors={selectedEntry.spot.goodSectors}
          />
        )}
      </section>

      {editingSectorsId && (() => {
        const spot = spots.find((s) => s.id === editingSectorsId);
        return spot ? (
          <SpotSettingsDialog
            spot={spot}
            onSave={(settings) => handleSaveSettings(spot.id, settings)}
            onClose={() => setEditingSectorsId(null)}
          />
        ) : null;
      })()}

      <SessionLog sessions={sessions} onChange={setSessions} />

      {loggingSpotId && (() => {
        const e = effectiveSpots.find((x) => x.spot.id === loggingSpotId);
        return e ? (
          <LogSessionDialog
            spot={e.spot}
            history={e.history}
            marine={e.marine}
            historyIsModelled={e.historyIsModelled}
            stationName={e.obsStation?.name}
            onSave={(session) => setSessions(addSession(session))}
            onClose={() => setLoggingSpotId(null)}
          />
        ) : null;
      })()}

      {showAdd && (
        <AddSpotDialog
          existingIds={existingIds}
          onAdd={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
