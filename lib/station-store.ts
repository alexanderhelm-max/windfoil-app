import { DEFAULT_STATIONS, Station } from './stations';

const KEY = 'windfoil:stations:v1';

export function loadStations(): Station[] {
  if (typeof window === 'undefined') return DEFAULT_STATIONS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATIONS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STATIONS;
    return parsed as Station[];
  } catch {
    return DEFAULT_STATIONS;
  }
}

export function saveStations(stations: Station[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(stations));
}

export function resetStations(): Station[] {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY);
  return DEFAULT_STATIONS;
}
