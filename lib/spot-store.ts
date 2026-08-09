import { DEFAULT_SPOTS, Spot } from './spots';

const KEY = 'windfoil:spots:v1';
/** Pre-rename key. Read once to carry existing lists over; never written to. */
const LEGACY_KEY = 'windfoil:stations:v1';

export function loadSpots(): Spot[] {
  if (typeof window === 'undefined') return DEFAULT_SPOTS;
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // First load after the spot/station rename: adopt the old list rather
      // than silently resetting everyone to defaults. The legacy key is left
      // in place, so an older build still finds the list it expects.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(KEY, legacy);
        raw = legacy;
      }
    }
    if (!raw) return DEFAULT_SPOTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SPOTS;
    return (parsed as Spot[]).map(refreshFromDefaults);
  } catch {
    return DEFAULT_SPOTS;
  }
}

/**
 * Saved lists are snapshots from whenever the user first visited, so fixes to
 * DEFAULT_SPOTS (corrected coordinates, newly paired station ids) would never
 * reach existing users. Refresh the data fields of any saved spot that is
 * still one of ours; user-added spots and removals are untouched.
 */
function refreshFromDefaults(spot: Spot): Spot {
  const def = DEFAULT_SPOTS.find((d) => d.id === spot.id);
  return def ? { ...def } : spot;
}

export function saveSpots(spots: Spot[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(spots));
}

export function resetSpots(): Spot[] {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEY);
    // Clear the legacy key too, or the next load would re-adopt the old list
    // and the reset would appear not to have worked.
    localStorage.removeItem(LEGACY_KEY);
  }
  return DEFAULT_SPOTS;
}
