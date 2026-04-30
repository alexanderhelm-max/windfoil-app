'use client';

import { useEffect, useMemo, useState } from 'react';
import { Station } from '@/lib/stations';

interface RemoteStation {
  id: number;
  name: string;
  lat: number | null;
  lon: number | null;
}

type Tab = 'viva' | 'smhi' | 'custom';

interface AddStationDialogProps {
  existingIds: Set<string>;
  onAdd: (station: Station) => void;
  onClose: () => void;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function AddStationDialog({ existingIds, onAdd, onClose }: AddStationDialogProps) {
  const [tab, setTab] = useState<Tab>('viva');
  const [vivaList, setVivaList] = useState<RemoteStation[] | null>(null);
  const [smhiList, setSmhiList] = useState<RemoteStation[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // VIVA tab state
  const [pickedViva, setPickedViva] = useState<RemoteStation | null>(null);
  const [pairSmhi, setPairSmhi] = useState<RemoteStation | null>(null);

  // SMHI tab state
  const [pickedSmhi, setPickedSmhi] = useState<RemoteStation | null>(null);

  // Custom tab state
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customLat, setCustomLat] = useState('');
  const [customLon, setCustomLon] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'viva' && vivaList === null) {
      fetch('/api/viva-stations')
        .then((r) => r.json())
        .then((d: { stations: RemoteStation[] }) => setVivaList(d.stations ?? []))
        .catch(() => setVivaList([]));
    }
    if ((tab === 'smhi' || (tab === 'viva' && pickedViva)) && smhiList === null) {
      fetch('/api/smhi-stations')
        .then((r) => r.json())
        .then((d: { stations: RemoteStation[] }) => setSmhiList(d.stations ?? []))
        .catch(() => setSmhiList([]));
    }
  }, [tab, vivaList, smhiList, pickedViva]);

  // Auto-suggest nearest SMHI obs station when VIVA is picked
  useEffect(() => {
    if (!pickedViva || !smhiList || pickedViva.lat == null || pickedViva.lon == null) return;
    if (pairSmhi !== null) return;
    let best: RemoteStation | null = null;
    let bestDist = Infinity;
    for (const s of smhiList) {
      if (s.lat == null || s.lon == null) continue;
      const d = distanceKm(pickedViva.lat, pickedViva.lon, s.lat, s.lon);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best && bestDist < 50) setPairSmhi(best);
  }, [pickedViva, smhiList, pairSmhi]);

  const filteredViva = useMemo(() => {
    if (!vivaList) return [];
    const q = search.trim().toLowerCase();
    if (!q) return vivaList.slice(0, 200);
    return vivaList.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 200);
  }, [vivaList, search]);

  const filteredSmhi = useMemo(() => {
    if (!smhiList) return [];
    const q = search.trim().toLowerCase();
    if (!q) return smhiList.slice(0, 200);
    return smhiList.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 200);
  }, [smhiList, search]);

  function commit(station: Station) {
    if (existingIds.has(station.id)) {
      setError(`Station "${station.id}" is already in your list.`);
      return;
    }
    if (station.lat < -90 || station.lat > 90 || station.lon < -180 || station.lon > 180) {
      setError('Latitude must be in [-90,90] and longitude in [-180,180].');
      return;
    }
    setError(null);
    onAdd(station);
    onClose();
  }

  function addViva() {
    if (!pickedViva || pickedViva.lat == null || pickedViva.lon == null) {
      setError('Pick a VIVA station with valid coordinates first.');
      return;
    }
    commit({
      id: `viva-${pickedViva.id}`,
      name: pickedViva.name,
      description: 'VIVA station',
      vivaId: pickedViva.id,
      smhiObsId: pairSmhi ? pairSmhi.id : null,
      lat: pickedViva.lat,
      lon: pickedViva.lon,
    });
  }

  function addSmhi() {
    if (!pickedSmhi || pickedSmhi.lat == null || pickedSmhi.lon == null) {
      setError('Pick an SMHI station with valid coordinates first.');
      return;
    }
    commit({
      id: `smhi-${pickedSmhi.id}`,
      name: pickedSmhi.name,
      description: 'SMHI station',
      vivaId: null,
      smhiObsId: pickedSmhi.id,
      lat: pickedSmhi.lat,
      lon: pickedSmhi.lon,
    });
  }

  function addCustom() {
    const lat = parseFloat(customLat);
    const lon = parseFloat(customLon);
    if (!customName.trim()) {
      setError('Name is required.');
      return;
    }
    if (isNaN(lat) || isNaN(lon)) {
      setError('Lat and lon must be numbers.');
      return;
    }
    commit({
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      description: customDesc.trim() || 'Custom point',
      vivaId: null,
      smhiObsId: null,
      lat,
      lon,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Add station</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex border-b border-slate-700">
          {(['viva', 'smhi', 'custom'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setSearch('');
                setError(null);
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? 'text-white border-b-2 border-blue-400 bg-slate-700/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'viva' ? 'VIVA station' : t === 'smhi' ? 'SMHI station only' : 'Custom point'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 px-3 py-2 rounded-md bg-red-900/40 border border-red-700 text-red-300 text-sm">
              {error}
            </div>
          )}

          {tab === 'viva' && (
            <div className="space-y-3">
              {!pickedViva ? (
                <>
                  <input
                    type="text"
                    placeholder="Search VIVA stations..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-blue-400"
                  />
                  {vivaList === null ? (
                    <p className="text-slate-400 text-sm">Loading stations...</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-md border border-slate-700 divide-y divide-slate-700">
                      {filteredViva.length === 0 && (
                        <p className="text-slate-500 text-sm p-3">No matches.</p>
                      )}
                      {filteredViva.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setPickedViva(s)}
                          disabled={s.lat == null || s.lon == null}
                          className="w-full text-left px-3 py-2 hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                        >
                          <div className="font-medium text-slate-100">{s.name}</div>
                          <div className="text-xs text-slate-500">
                            ID {s.id}
                            {s.lat != null && s.lon != null
                              ? ` · ${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`
                              : ' · no coordinates'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-900 border border-slate-700 rounded-md p-3">
                    <div className="text-xs text-slate-500">Selected VIVA station</div>
                    <div className="font-semibold text-white">{pickedViva.name}</div>
                    <div className="text-xs text-slate-400">
                      ID {pickedViva.id}
                      {pickedViva.lat != null && pickedViva.lon != null
                        ? ` · ${pickedViva.lat.toFixed(3)}, ${pickedViva.lon.toFixed(3)}`
                        : ''}
                    </div>
                    <button
                      onClick={() => {
                        setPickedViva(null);
                        setPairSmhi(null);
                      }}
                      className="mt-2 text-xs text-blue-400 hover:underline"
                    >
                      Change
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Pair with SMHI obs station (for 24h history) — optional
                    </label>
                    {smhiList === null ? (
                      <p className="text-slate-500 text-sm">Loading SMHI stations...</p>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="Search SMHI stations..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 mb-2"
                        />
                        {pairSmhi && (
                          <div className="bg-slate-900 border border-slate-700 rounded-md p-2 mb-2 flex items-center justify-between">
                            <div>
                              <span className="text-xs text-slate-500">Paired:</span>{' '}
                              <span className="text-slate-100 text-sm">{pairSmhi.name}</span>
                              <span className="text-xs text-slate-500 ml-2">ID {pairSmhi.id}</span>
                            </div>
                            <button
                              onClick={() => setPairSmhi(null)}
                              className="text-xs text-slate-400 hover:text-red-400"
                            >
                              Clear
                            </button>
                          </div>
                        )}
                        <div className="max-h-48 overflow-y-auto rounded-md border border-slate-700 divide-y divide-slate-700">
                          {filteredSmhi.slice(0, 50).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => setPairSmhi(s)}
                              className="w-full text-left px-3 py-2 hover:bg-slate-700/50 text-sm"
                            >
                              <div className="text-slate-100">{s.name}</div>
                              <div className="text-xs text-slate-500">ID {s.id}</div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    onClick={addViva}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md transition"
                  >
                    Add station
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'smhi' && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Search SMHI stations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-blue-400"
              />
              {smhiList === null ? (
                <p className="text-slate-400 text-sm">Loading stations...</p>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-md border border-slate-700 divide-y divide-slate-700">
                  {filteredSmhi.length === 0 && (
                    <p className="text-slate-500 text-sm p-3">No matches.</p>
                  )}
                  {filteredSmhi.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setPickedSmhi(s)}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-700/50 text-sm ${
                        pickedSmhi?.id === s.id ? 'bg-slate-700/60' : ''
                      }`}
                    >
                      <div className="font-medium text-slate-100">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        ID {s.id} · {s.lat?.toFixed(3)}, {s.lon?.toFixed(3)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={addSmhi}
                disabled={!pickedSmhi}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-md transition"
              >
                Add station
              </button>
            </div>
          )}

          {tab === 'custom' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={customLon}
                    onChange={(e) => setCustomLon(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-white focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <button
                onClick={addCustom}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md transition"
              >
                Add station
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
