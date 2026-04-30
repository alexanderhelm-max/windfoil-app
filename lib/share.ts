import { VivaObservation } from './viva';
import {
  ConditionLevel,
  conditionLabels,
  getCondition,
  getGustLevel,
  headingToCompass,
} from './wind-utils';

const conditionEmoji: Record<ConditionLevel, string> = {
  'too-little': '⚪',
  'ok': '🟡',
  'great': '🟢',
  'crazy': '🟠',
};

const gustEmoji = { smooth: '😎', moderate: '🌬️', gusty: '💨' };

export function formatStationMessage(
  stationName: string,
  description: string,
  current: VivaObservation,
  appUrl: string
): string {
  const condition = getCondition(current.avgWind, current.heading);
  const gustLevel = getGustLevel(current.avgWind, current.gust);
  const compass = headingToCompass(current.heading);
  const lines = [
    `🏄 ${stationName} (${description})`,
    `${conditionEmoji[condition]} ${conditionLabels[condition]}`,
    `💨 ${current.avgWind.toFixed(1)} m/s avg · ${current.gust.toFixed(1)} gust · ${compass} ${current.heading}°`,
    `${gustEmoji[gustLevel]} ${gustLevel === 'smooth' ? 'Smooth' : gustLevel === 'moderate' ? 'Moderate gusts' : 'Gusty'}`,
  ];
  if (current.waterTemp !== undefined) {
    lines.push(`🌊 Water ${current.waterTemp.toFixed(1)}°C`);
  }
  lines.push('');
  lines.push(appUrl);
  return lines.join('\n');
}

export interface RankedSpotShare {
  stationName: string;
  start: Date;
  durationHours: number;
  avgWindSpeed: number;
  peakWindSpeed: number;
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
    return `🏄 ${windowLabel}: no good foiling windows.\n\n${appUrl}`;
  }
  const lines = [`🏄 Best foiling spots — ${windowLabel}`];
  spots.slice(0, 5).forEach((s, i) => {
    lines.push(
      `${i + 1}. ${s.stationName} ${conditionEmoji[s.condition]} ${shortTime(s.start)} (${s.durationHours.toFixed(0)}h) — ${s.avgWindSpeed.toFixed(1)}/${s.peakWindSpeed.toFixed(1)} m/s avg/peak`
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
