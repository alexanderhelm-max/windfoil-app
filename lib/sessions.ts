import { SmhiObsHistory } from './smhi';
import { MarineNow } from './marine';

/**
 * A logged session: what you rode, when, how good it was, and — snapshotted —
 * what the conditions actually were.
 *
 * The snapshot is the point. Observation APIs only reach 24 hours back, spots
 * get re-paired to different stations, and sectors get edited; re-deriving
 * conditions later would give a different answer or none at all. So a session
 * keeps the numbers it was ridden in, forever.
 *
 * The corollary is a real constraint on the UI: a session must be logged
 * within a day of riding it, or there is nothing left to snapshot.
 */
export interface SessionConditions {
  avgWind: number;
  maxGust: number;
  /** gust / avg over the window — how much it was moving about. */
  gustRatio: number;
  /** Circular mean bearing, degrees the wind blew FROM. */
  dirMean: number | null;
  /** Whether the wind came from a real sensor or a model at log time. */
  source: 'measured' | 'model';
  /** Which station supplied it, when one did. */
  stationName?: string;
  waveHeight?: number;
  wavePeriod?: number;
  /** Points the averages were taken over — thin windows mean weak numbers. */
  sampleCount: number;
}

export interface Session {
  id: string;
  spotId: string;
  spotName: string;
  /** Epoch ms. */
  start: number;
  end: number;
  rating: 1 | 2 | 3 | 4 | 5;
  note?: string;
  gear?: string;
  conditions: SessionConditions;
  createdAt: number;
}

/** Circular mean of bearings — a plain average would put 350° and 10° at 180°. */
function meanBearing(degrees: number[]): number | null {
  if (degrees.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const d of degrees) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
  }
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Summarise what the wind did over a window, from the history already fetched
 * for the chart. Returns null when the window holds no readings — better to
 * refuse than to log a session with invented conditions.
 */
export function summariseConditions(
  history: SmhiObsHistory | null,
  start: number,
  end: number,
  opts: { source: 'measured' | 'model'; stationName?: string; marine?: MarineNow | null }
): SessionConditions | null {
  if (!history) return null;
  const inWindow = <T extends { time: number }>(pts: T[]) =>
    pts.filter((p) => p.time >= start && p.time <= end);

  const speeds = inWindow(history.windSpeed);
  if (speeds.length === 0) return null;
  const gusts = inWindow(history.gust);
  const dirs = inWindow(history.windDir);

  const avgWind = speeds.reduce((a, p) => a + p.value, 0) / speeds.length;
  const maxGust = gusts.length > 0 ? Math.max(...gusts.map((p) => p.value)) : avgWind;

  return {
    avgWind,
    maxGust,
    gustRatio: avgWind > 0 ? maxGust / avgWind : 1,
    dirMean: meanBearing(dirs.map((p) => p.value)),
    source: opts.source,
    ...(opts.stationName ? { stationName: opts.stationName } : {}),
    ...(opts.marine?.waveHeight != null ? { waveHeight: opts.marine.waveHeight } : {}),
    ...(opts.marine?.wavePeriod != null ? { wavePeriod: opts.marine.wavePeriod } : {}),
    sampleCount: speeds.length,
  };
}

// ---- Storage -------------------------------------------------------------
// localStorage for now. This is the first data here that would genuinely hurt
// to lose — it can't be re-fetched from anywhere — so export exists from the
// start rather than as a later nicety.

const KEY = 'windfoil:sessions:v1';

export function loadSessions(): Session[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Session[]).sort((a, b) => b.start - a.start);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export function addSession(session: Session): Session[] {
  const next = [session, ...loadSessions()].sort((a, b) => b.start - a.start);
  saveSessions(next);
  return next;
}

export function removeSession(id: string): Session[] {
  const next = loadSessions().filter((s) => s.id !== id);
  saveSessions(next);
  return next;
}

export function exportSessions(): string {
  return JSON.stringify({ version: 1, sessions: loadSessions() }, null, 2);
}

/**
 * Merge an exported file back in, keyed by id so re-importing the same file
 * doesn't duplicate. Returns how many were added, or null if the file wasn't
 * a session export.
 */
export function importSessions(json: string): number | null {
  try {
    const parsed = JSON.parse(json);
    const incoming: unknown = parsed?.sessions;
    if (!Array.isArray(incoming)) return null;
    const existing = loadSessions();
    const seen = new Set(existing.map((s) => s.id));
    const valid = incoming.filter(
      (s): s is Session =>
        !!s &&
        typeof s.id === 'string' &&
        typeof s.spotId === 'string' &&
        typeof s.start === 'number' &&
        typeof s.rating === 'number' &&
        !!s.conditions
    );
    const fresh = valid.filter((s) => !seen.has(s.id));
    if (fresh.length > 0) saveSessions([...existing, ...fresh].sort((a, b) => b.start - a.start));
    return fresh.length;
  } catch {
    return null;
  }
}
