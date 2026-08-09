import { VivaObservation } from './viva';
import {
  ConditionLevel,
  conditionLabels,
  getCondition,
  getGustLevel,
  headingToCompass,
} from './wind-utils';

// Plain text labels — avoiding emojis that older platforms render as � (mojibake).
// The colored circle emojis (Unicode 12.0, 2019) and 🌬️ (variation selector) are the worst offenders.
const gustText: Record<'smooth' | 'moderate' | 'gusty', string> = {
  smooth: 'Smooth',
  moderate: 'Moderate gusts',
  gusty: 'Gusty',
};

export function formatSpotMessage(
  spotName: string,
  description: string,
  current: VivaObservation,
  appUrl: string
): string {
  const condition = getCondition(current.avgWind, current.heading);
  const gustLevel = getGustLevel(current.avgWind, current.gust);
  const compass = headingToCompass(current.heading);
  const lines = [
    `*${spotName}* (${description})`,
    `Condition: ${conditionLabels[condition]}`,
    `Wind: ${current.avgWind.toFixed(1)} m/s avg / ${current.gust.toFixed(1)} gust — ${compass} ${current.heading}°`,
    `Gusts: ${gustText[gustLevel]}`,
  ];
  if (current.airTemp !== undefined) {
    lines.push(`Air: ${current.airTemp.toFixed(1)}°C`);
  }
  if (current.waterTemp !== undefined) {
    lines.push(`Water: ${current.waterTemp.toFixed(1)}°C`);
  }
  lines.push('');
  lines.push(appUrl);
  return lines.join('\n');
}

export interface RankedSpotShare {
  spotName: string;
  start: Date;
  durationHours: number;
  avgWindSpeed: number;
  peakWindSpeed: number;
  avgWindDir: number;
  condition: ConditionLevel;
}

function shortTime(d: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const hhmm = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (d >= todayStart && d < tomorrowStart) return `Today ${hhmm}`;
  if (d >= tomorrowStart && d < new Date(tomorrowStart.getTime() + 86400000)) return `Tom ${hhmm}`;
  return d.toLocaleDateString('sv-SE', { weekday: 'short' }) + ` ${hhmm}`;
}

export function formatRankingMessage(
  windowLabel: string,
  spots: RankedSpotShare[],
  appUrl: string
): string {
  if (spots.length === 0) {
    return `Best foiling spots — ${windowLabel}: no good windows found.\n\n${appUrl}`;
  }
  const lines = [`*Best foiling spots — ${windowLabel}*`];
  spots.slice(0, 5).forEach((s, i) => {
    const dir = `${headingToCompass(s.avgWindDir)} ${Math.round(s.avgWindDir)}°`;
    lines.push(
      `${i + 1}. ${s.spotName} [${conditionLabels[s.condition]}] — ${shortTime(s.start)} (${s.durationHours.toFixed(0)}h) — ${dir} — ${s.avgWindSpeed.toFixed(1)}/${s.peakWindSpeed.toFixed(1)} m/s avg/peak`
    );
  });
  lines.push('');
  lines.push(appUrl);
  return lines.join('\n');
}

export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function getAppUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

// ---- Spot-list sharing via URL ----------------------------------------
// The list is encoded as a compact JSON tuple array in a base64url query
// param, so sharing needs no backend: the recipient's browser decodes it and
// offers an import. Tuple order: [id, name, description, vivaId, smhiObsId,
// holfuyId, lat, lon].

import type { Spot } from './spots';

type SpotTuple = [
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
  number,
  number,
];

export function encodeSpotsToParam(spots: Spot[]): string {
  const compact: SpotTuple[] = spots.map((s) => [
    s.id,
    s.name,
    s.description,
    s.vivaId,
    s.smhiObsId,
    s.holfuyId ?? null,
    s.lat,
    s.lon,
  ]);
  const json = JSON.stringify(compact);
  // btoa only handles latin-1; round-trip through UTF-8 bytes for å/ä/ö.
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildShareSpotsUrl(spots: Spot[]): string {
  return `${getAppUrl()}/?spots=${encodeSpotsToParam(spots)}`;
}

/** Decode a shared spot list. Returns null on any malformed input —
 *  the param is user-controlled data from a URL, so everything is checked. */
export function decodeSpotsFromParam(param: string): Spot[] | null {
  try {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed)) return null;
    const out: Spot[] = [];
    for (const t of parsed.slice(0, 50)) {
      if (!Array.isArray(t) || t.length < 8) continue;
      const [id, name, description, vivaId, smhiObsId, holfuyId, lat, lon] = t as unknown[];
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
      out.push({
        id: id.slice(0, 64),
        name: name.slice(0, 64),
        description: typeof description === 'string' ? description.slice(0, 128) : '',
        vivaId: num(vivaId),
        smhiObsId: num(smhiObsId),
        holfuyId: num(holfuyId),
        lat,
        lon,
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
