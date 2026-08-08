import { DEFAULT_STATIONS, Station } from './stations';

const KEY = 'windfoil:stations:v1';

export function loadStations(): Station[] {
  if (typeof window === 'undefined') return DEFAULT_STATIONS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATIONS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STATIONS;
    return (parsed as Station[]).map(refreshFromDefaults);
  } catch {
    return DEFAULT_STATIONS;
  }
}

/**
 * Saved lists are snapshots from whenever the user first visited, so fixes to
 * DEFAULT_STATIONS (corrected coordinates, newly paired station ids) would
 * never reach existing users. Refresh the data fields of any saved station
 * that is still one of ours; user-added stations and removals are untouched.
 */
function refreshFromDefaults(station: Station): Station {
  const def = DEFAULT_STATIONS.find((d) => d.id === station.id);
  return def ? { ...def } : station;
}

export function saveStations(stations: Station[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(stations));
}

export function resetStations(): Station[] {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY);
  return DEFAULT_STATIONS;
}
