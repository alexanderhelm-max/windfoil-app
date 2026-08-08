'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VivaObservation } from '@/lib/viva';
import { Station } from '@/lib/stations';
import { VIVA_STATIONS_SNAPSHOT, VivaSnapshotStation } from '@/lib/viva-stations.snapshot';
import {
  getCondition,
  conditionColors,
  conditionLabels,
  headingToCompass,
} from '@/lib/wind-utils';

export interface MapEntry {
  station: Station;
  current: VivaObservation | null;
  windIsForecast: boolean;
  currentStation: { name: string; distanceKm: number } | null;
}

interface WindMapProps {
  entries: MapEntry[];
  selectedStationId: string | null;
  onSelect: (stationId: string) => void;
  onDeselect: () => void;
  onOpenTimeline: (stationId: string) => void;
  onAddStation: (station: Station) => void;
  existingIds: Set<string>;
}

const VIVA_LAYER_KEY = 'windfoil:map:viva:v1';
const SMHI_LAYER_KEY = 'windfoil:map:smhi:v1';

interface LiveWind {
  avg: number;
  dir: number | null;
}

interface SmhiMapStation {
  id: number;
  name: string;
  lat: number;
  lon: number;
  avg: number | null;
  dir: number | null;
}

/** Readable against the dark basemap — a dimmer grey disappears into it. */
const NO_DATA_COLOR = '#94a3b8';

/**
 * Colour for a station dot. Direction shifts the thresholds by 1 m/s when the
 * wind is off-sector, so where a station reports no direction we evaluate at a
 * mid-sector bearing — that grades on speed alone rather than guessing badly.
 */
function dotColor(avg: number | null, dir: number | null): string {
  if (avg == null) return NO_DATA_COLOR;
  return conditionColors[getCondition(avg, dir ?? 250)];
}

/** Arrow points where the wind is going, so heading (wind FROM) + 180°. */
function arrowSvg(heading: number, size: number, color: string): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" ` +
    `style="display:block;transform:rotate(${(heading + 180) % 360}deg)">` +
    `<path d="M12 2L8 20l4-3 4 3z"/></svg>`
  );
}

/**
 * Round marker: speed above, wind arrow below. A circle stays compact whatever
 * the number, so markers crowd far less than a name-bearing pill would — the
 * name lives in the info card once a spot is picked.
 *
 * The icon is declared 0×0 and the content self-centres with a transform, so
 * the offset from decluttering can be applied without disturbing the anchor.
 */
function spotIcon(
  entry: MapEntry,
  isSelected: boolean,
  offset: [number, number] = [0, 0]
): L.DivIcon {
  const { current } = entry;
  const hasWind = !!current;
  const condition = hasWind ? getCondition(current.avgWind, current.heading) : 'too-little';
  const color = hasWind ? conditionColors[condition] : '#64748b';
  const speed = hasWind ? current.avgWind.toFixed(1) : '–';
  const size = isSelected ? 48 : 42;

  const circle =
    `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;` +
    `background:rgba(15,23,42,.95);border:2px solid ${color};` +
    `box-shadow:0 2px 10px rgba(0,0,0,.6)${isSelected ? `,0 0 0 5px ${color}44` : ''};` +
    `font:700 ${isSelected ? 15 : 13}px/1 ui-sans-serif,system-ui,sans-serif;color:#f1f5f9">` +
    `<span>${entry.windIsForecast ? '~' : ''}${speed}</span>` +
    (hasWind ? arrowSvg(current.heading, 10, color) : '') +
    `</div>`;

  return L.divIcon({
    html:
      `<div style="transform:translate(calc(-50% + ${offset[0].toFixed(0)}px),` +
      `calc(-50% + ${offset[1].toFixed(0)}px))">${circle}</div>`,
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** Lifts the map's zoom so markers can adapt their density. */
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

/**
 * Reports which VIVA stations are on screen, debounced.
 *
 * VIVA has no bulk endpoint, so live wind costs one upstream request per
 * station — only the ones actually in view are worth asking for, and the
 * server caps the list besides.
 */
function ViewportWatcher({ onView }: { onView: (b: L.LatLngBounds) => void }) {
  const timer = useRef<number | null>(null);
  const map = useMapEvents({
    moveend: () => schedule(),
    zoomend: () => schedule(),
  });

  function schedule() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onView(map.getBounds()), 500);
  }

  useEffect(() => {
    onView(map.getBounds());
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [map, onView]);
  return null;
}

/**
 * Nudge markers apart where they'd overlap on screen.
 *
 * Karet and Torshamnen are 4.7 km apart — a couple of dozen pixels at overview
 * zoom — so their markers sit on top of each other and neither reads. This
 * pushes colliding pairs apart in pixel space; each marker stays anchored to
 * its true coordinate with only the circle drawn offset, and the offsets fall
 * to zero as zooming in separates the spots naturally.
 */
function useDeclutterOffsets(entries: MapEntry[], zoom: number): [number, number][] {
  const map = useMap();
  return useMemo(() => {
    const MIN_GAP = 46;
    const pts = entries.map((e) => map.latLngToLayerPoint([e.station.lat, e.station.lon]));
    const off: [number, number][] = entries.map(() => [0, 0]);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const dx = pts[j].x + off[j][0] - (pts[i].x + off[i][0]);
        const dy = pts[j].y + off[j][1] - (pts[i].y + off[i][1]);
        const d = Math.hypot(dx, dy);
        if (d >= MIN_GAP) continue;
        const push = (MIN_GAP - d) / 2 + 1;
        // Exactly co-located points have no direction to separate along;
        // fall back to pushing them vertically apart.
        const ux = d === 0 ? 0 : dx / d;
        const uy = d === 0 ? 1 : dy / d;
        off[i][0] -= ux * push;
        off[i][1] -= uy * push;
        off[j][0] += ux * push;
        off[j][1] += uy * push;
      }
    }
    return off;
    // Relative pixel distances are pan-invariant, so zoom is the only trigger.
  }, [entries, map, zoom]);
}

/** Frame the user's spots once on mount. */
function FitBounds({ entries }: { entries: MapEntry[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = entries.map((e) => [e.station.lat, e.station.lon] as [number, number]);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 12 });
    // Framed once: re-fitting on every data tick would fight the user's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SpotMarkers({
  entries,
  zoom,
  selectedStationId,
  onSelect,
}: {
  entries: MapEntry[];
  zoom: number;
  selectedStationId: string | null;
  onSelect: (id: string) => void;
}) {
  const offsets = useDeclutterOffsets(entries, zoom);
  return (
    <>
      {entries.map((e, i) => (
        <Marker
          key={e.station.id}
          position={[e.station.lat, e.station.lon]}
          icon={spotIcon(e, e.station.id === selectedStationId, offsets[i])}
          // Windier spots draw above calmer ones so the interesting markers
          // stay on top where spots sit close together.
          zIndexOffset={Math.round((e.current?.avgWind ?? 0) * 10)}
          eventHandlers={{ click: () => onSelect(e.station.id) }}
        >
          <Tooltip direction="top" offset={[0, -26]}>
            {e.station.name}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

export default function WindMap({
  entries,
  selectedStationId,
  onSelect,
  onDeselect,
  onOpenTimeline,
  onAddStation,
  existingIds,
}: WindMapProps) {
  const [showViva, setShowViva] = useState(true);
  const [showSmhi, setShowSmhi] = useState(false);
  const [zoom, setZoom] = useState(9);
  const [pendingViva, setPendingViva] = useState<VivaSnapshotStation | null>(null);
  const [pendingSmhi, setPendingSmhi] = useState<SmhiMapStation | null>(null);
  const [smhiStations, setSmhiStations] = useState<SmhiMapStation[]>([]);
  const [liveViva, setLiveViva] = useState<Record<number, LiveWind>>({});
  const requestedRef = useRef<string>('');

  useEffect(() => {
    if (localStorage.getItem(VIVA_LAYER_KEY) === 'off') setShowViva(false);
    if (localStorage.getItem(SMHI_LAYER_KEY) === 'on') setShowSmhi(true);
  }, []);

  function toggleViva() {
    setShowViva((v) => {
      localStorage.setItem(VIVA_LAYER_KEY, v ? 'off' : 'on');
      return !v;
    });
  }

  function toggleSmhi() {
    setShowSmhi((v) => {
      localStorage.setItem(SMHI_LAYER_KEY, v ? 'off' : 'on');
      return !v;
    });
  }

  const center = useMemo<[number, number]>(() => {
    if (entries.length === 0) return [57.7, 11.7];
    const lat = entries.reduce((s, e) => s + e.station.lat, 0) / entries.length;
    const lon = entries.reduce((s, e) => s + e.station.lon, 0) / entries.length;
    return [lat, lon];
  }, [entries]);

  // VIVA stations not already used as a spot — the map doubles as the catalog.
  const availableViva = useMemo(
    () => VIVA_STATIONS_SNAPSHOT.filter((v) => !existingIds.has(`viva-${v.id}`)),
    [existingIds]
  );

  const selected = entries.find((e) => e.station.id === selectedStationId) ?? null;

  /**
   * Only one card shows at a time, so opening a candidate has to drop the
   * picked spot — otherwise tapping a station dot while a spot card is open
   * looks like nothing happened.
   */
  function showCandidate(open: () => void) {
    onDeselect();
    setPendingViva(null);
    setPendingSmhi(null);
    open();
  }

  // One request serves both layers: SMHI comes back whole (its bulk endpoint
  // is a single upstream call) while VIVA is limited to what's on screen.
  const loadLive = useCallback(
    async (bounds: L.LatLngBounds) => {
      const inView = VIVA_STATIONS_SNAPSHOT.filter((v) =>
        bounds.contains([v.lat, v.lon] as L.LatLngTuple)
      ).slice(0, 40);
      const ids = inView.map((v) => v.id).sort((a, b) => a - b);
      const key = ids.join(',');
      // Panning within the same set of stations shouldn't refetch.
      if (key === requestedRef.current) return;
      requestedRef.current = key;
      try {
        const res = await fetch(`/api/map-stations?viva=${key}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          smhi: SmhiMapStation[];
          viva: { id: number; avg: number; dir: number }[];
        };
        setSmhiStations(data.smhi ?? []);
        setLiveViva((prev) => {
          const next = { ...prev };
          for (const v of data.viva ?? []) next[v.id] = { avg: v.avg, dir: v.dir };
          return next;
        });
      } catch {
        // Live colours are a nicety — dots stay grey and remain addable.
      }
    },
    []
  );

  const availableSmhi = useMemo(
    () => smhiStations.filter((s) => !existingIds.has(`smhi-${s.id}`)),
    [smhiStations, existingIds]
  );

  function addSmhiStation(s: SmhiMapStation) {
    onAddStation({
      id: `smhi-${s.id}`,
      name: s.name,
      description: 'SMHI station',
      vivaId: null,
      smhiObsId: s.id,
      holfuyId: null,
      lat: s.lat,
      lon: s.lon,
    });
    setPendingSmhi(null);
  }

  function addVivaStation(v: VivaSnapshotStation) {
    onAddStation({
      id: `viva-${v.id}`,
      name: v.name,
      description: 'VIVA station',
      vivaId: v.id,
      smhiObsId: null,
      holfuyId: null,
      lat: v.lat,
      lon: v.lon,
    });
    setPendingViva(null);
  }

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-700 mb-6">
      <MapContainer
        center={center}
        zoom={9}
        scrollWheelZoom
        preferCanvas
        zoomControl={false}
        // Continuous zoom rather than Leaflet's default integer steps: the
        // wheel and pinch glide, and the +/- buttons move half a level at a
        // time instead of jumping. Wheel sensitivity stays at Leaflet's
        // default — raising it made a trackpad feel sluggish, and smooth is
        // about removing the steps, not slowing the gesture down.
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={60}
        wheelDebounceTime={20}
        zoomAnimation
        style={{ height: '68vh', minHeight: 420, background: '#0f172a' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          maxZoom={19}
        />
        {/* Bottom-right rather than Leaflet's default top-left: reachable by
            thumb on a phone, and clear of the layer toggle. */}
        <ZoomControl position="bottomright" />
        <ZoomWatcher onZoom={setZoom} />
        <ViewportWatcher onView={loadLive} />
        <FitBounds entries={entries} />

        {showSmhi &&
          availableSmhi.map((s) => {
            const color = dotColor(s.avg, s.dir);
            return (
              <CircleMarker
                key={`smhi-${s.id}`}
                center={[s.lat, s.lon]}
                radius={s.avg == null ? 4 : 5}
                pathOptions={{
                  color,
                  weight: 1.5,
                  opacity: s.avg == null ? 0.85 : 1,
                  fillColor: color,
                  fillOpacity: s.avg == null ? 0.35 : 0.7,
                }}
                eventHandlers={{ click: () => showCandidate(() => setPendingSmhi(s)) }}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  {s.name}
                  {s.avg != null && ` · ${s.avg.toFixed(1)} m/s`}
                </Tooltip>
              </CircleMarker>
            );
          })}

        {showViva &&
          availableViva.map((v) => {
            const live = liveViva[v.id];
            const color = dotColor(live?.avg ?? null, live?.dir ?? null);
            return (
              <CircleMarker
                key={v.id}
                center={[v.lat, v.lon]}
                radius={live ? 5.5 : 4}
                pathOptions={{
                  color,
                  weight: 1.5,
                  opacity: live ? 1 : 0.85,
                  fillColor: color,
                  fillOpacity: live ? 0.75 : 0.35,
                }}
                eventHandlers={{ click: () => showCandidate(() => setPendingViva(v)) }}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  {v.name}
                  {live && ` · ${live.avg.toFixed(1)} m/s`}
                </Tooltip>
              </CircleMarker>
            );
          })}

        <SpotMarkers
          entries={entries}
          zoom={zoom}
          selectedStationId={selectedStationId}
          onSelect={(id) => {
            setPendingViva(null);
            setPendingSmhi(null);
            onSelect(id);
          }}
        />
      </MapContainer>

      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5 items-end">
        <button
          onClick={toggleViva}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition ${
            showViva
              ? 'bg-slate-800/95 border-slate-500 text-slate-100'
              : 'bg-slate-800/80 border-slate-700 text-slate-500 hover:text-slate-300'
          }`}
          title="VIVA stations — tap a dot to add it as a spot"
        >
          {showViva ? '●' : '○'} VIVA {availableViva.length}
        </button>
        <button
          onClick={toggleSmhi}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition ${
            showSmhi
              ? 'bg-slate-800/95 border-slate-500 text-slate-100'
              : 'bg-slate-800/80 border-slate-700 text-slate-500 hover:text-slate-300'
          }`}
          title="SMHI weather stations — tap a dot to add it as a spot"
        >
          {showSmhi ? '●' : '○'} SMHI {availableSmhi.length || ''}
        </button>
      </div>

      {/* Info card — one panel for both a picked spot and a candidate station,
          so tapping anything on the map always answers in the same place. */}
      {selected && (
        <InfoCard onClose={onDeselect}>
          <SpotDetails entry={selected} onOpenTimeline={() => onOpenTimeline(selected.station.id)} />
        </InfoCard>
      )}
      {!selected && pendingViva && (
        <InfoCard onClose={() => setPendingViva(null)}>
          <StationCandidate
            name={pendingViva.name}
            subtitle={`VIVA station #${pendingViva.id}`}
            avg={liveViva[pendingViva.id]?.avg ?? null}
            dir={liveViva[pendingViva.id]?.dir ?? null}
            onAdd={() => addVivaStation(pendingViva)}
          />
        </InfoCard>
      )}
      {!selected && !pendingViva && pendingSmhi && (
        <InfoCard onClose={() => setPendingSmhi(null)}>
          <StationCandidate
            name={pendingSmhi.name}
            subtitle={`SMHI station #${pendingSmhi.id}`}
            avg={pendingSmhi.avg}
            dir={pendingSmhi.dir}
            onAdd={() => addSmhiStation(pendingSmhi)}
          />
        </InfoCard>
      )}
    </div>
  );
}

/** A station on the map that isn't in the user's list yet. */
function StationCandidate({
  name,
  subtitle,
  avg,
  dir,
  onAdd,
}: {
  name: string;
  subtitle: string;
  avg: number | null;
  dir: number | null;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="font-semibold text-white text-base pr-6">{name}</div>
      <div className="text-xs text-slate-400 mt-0.5 mb-3">{subtitle} · not in your list</div>
      {avg != null ? (
        <div className="flex items-baseline gap-2 mb-3">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: dotColor(avg, dir) }}
          >
            {avg.toFixed(1)}
          </span>
          <span className="text-sm text-slate-400">m/s</span>
          {dir != null && (
            <span className="text-xs text-slate-500 ml-auto">
              {headingToCompass(dir)} {Math.round(dir)}°
            </span>
          )}
        </div>
      ) : (
        <div className="text-xs text-slate-500 mb-3">No recent wind reading</div>
      )}
      <button
        onClick={onAdd}
        className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition"
      >
        + Add as spot
      </button>
    </>
  );
}

/** Floating panel: full width on phones, a card in the corner on desktop. */
function InfoCard({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute z-[1000] bottom-3 left-3 right-3 sm:right-auto sm:w-80 bg-slate-800/97 border border-slate-600 rounded-xl shadow-2xl p-4 backdrop-blur-sm">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2.5 right-3 text-slate-500 hover:text-white text-lg leading-none"
      >
        ×
      </button>
      {children}
    </div>
  );
}

function SpotDetails({ entry, onOpenTimeline }: { entry: MapEntry; onOpenTimeline: () => void }) {
  const c = entry.current;
  const condition = c ? getCondition(c.avgWind, c.heading) : null;
  const isLive = !!c && !entry.windIsForecast;

  return (
    <>
      <div className="font-semibold text-white text-base pr-6">{entry.station.name}</div>
      <div className="flex items-center gap-2 mt-1 mb-3">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${
            isLive ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-700 text-slate-400'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {isLive ? 'LIVE' : 'FORECAST'}
        </span>
        <span className="text-xs text-slate-400 truncate">
          {entry.currentStation
            ? `${entry.currentStation.name}${
                entry.currentStation.distanceKm >= 0.5
                  ? ` · ${entry.currentStation.distanceKm.toFixed(0)} km`
                  : ''
              }`
            : entry.station.description}
        </span>
      </div>

      {c ? (
        <div className="flex items-baseline gap-2 mb-3">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: conditionColors[condition!] }}
          >
            {entry.windIsForecast ? '~' : ''}
            {c.avgWind.toFixed(1)}
          </span>
          <span className="text-sm text-slate-400">m/s</span>
          <span className="text-xs text-slate-500 ml-auto text-right leading-tight">
            {c.gust.toFixed(1)} max
            <br />
            {headingToCompass(c.heading)} {Math.round(c.heading)}°
          </span>
        </div>
      ) : (
        <div className="text-slate-400 text-sm mb-3">No data</div>
      )}

      {condition && (
        <div className="text-xs mb-3" style={{ color: conditionColors[condition] }}>
          {conditionLabels[condition]}
        </div>
      )}

      <button
        onClick={onOpenTimeline}
        className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition"
      >
        Open timeline
      </button>
    </>
  );
}
