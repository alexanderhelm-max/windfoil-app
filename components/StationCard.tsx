'use client';

import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory, DaylightInfo } from '@/lib/smhi';
import {
  getCondition,
  getGustLevel,
  getTrendDetail,
  headingToCompass,
  conditionColors,
  conditionLabels,
  trendIcons,
  getWetsuitHint,
  getWingHint,
  ConditionLevel,
  GustLevel,
} from '@/lib/wind-utils';
import { formatStationMessage, getAppUrl } from '@/lib/share';
import ShareMenu from './ShareMenu';

interface StationCardProps {
  id: string;
  name: string;
  description: string;
  current: VivaObservation | null;
  history: SmhiObsHistory | null;
  recentObs: { time: number; wind: number }[];
  isSelected: boolean;
  onClick: () => void;
  onRemove?: (id: string) => void;
  /** True when the air temp came from forecast rather than a real sensor */
  airTempIsForecast?: boolean;
  /** True when the wind values came from forecast (e.g. station with no wind sensor) */
  windIsForecast?: boolean;
  daylight?: DaylightInfo | null;
}

function formatDaylightRemaining(d: DaylightInfo): string {
  if (!d.isDay) {
    if (d.remainingMinutes > 0) return 'before sunrise';
    return 'after sunset';
  }
  const h = Math.floor(d.remainingMinutes / 60);
  const m = d.remainingMinutes % 60;
  if (h === 0) return `${m}m daylight`;
  return `${h}h ${m}m daylight`;
}

const gustColors: Record<GustLevel, string> = {
  smooth: 'text-green-400',
  moderate: 'text-yellow-400',
  gusty: 'text-orange-400',
};

const gustLabels: Record<GustLevel, string> = {
  smooth: 'Smooth',
  moderate: 'Moderate gusts',
  gusty: 'Gusty',
};

function formatUpdated(updatedAt: string): string {
  try {
    const d = new Date(updatedAt);
    if (isNaN(d.getTime())) return updatedAt;
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return updatedAt;
  }
}

export default function StationCard({
  id,
  name,
  description,
  current,
  recentObs,
  isSelected,
  onClick,
  onRemove,
  airTempIsForecast = false,
  windIsForecast = false,
  daylight,
}: StationCardProps) {
  const avgWind = current?.avgWind ?? 0;
  const gust = current?.gust ?? 0;
  const heading = current?.heading ?? 0;

  const condition: ConditionLevel = getCondition(avgWind, heading);
  const gustLevel: GustLevel = getGustLevel(avgWind, gust);
  const trendDetail = getTrendDetail(recentObs);
  const trend = trendDetail.direction;
  const trendRate = trendDetail.ratePerHour;
  const compassDir = headingToCompass(heading);
  const condColor = conditionColors[condition];
  const wetsuit = getWetsuitHint(current?.waterTemp);
  const wing = getWingHint(avgWind);

  const borderStyle = isSelected
    ? `border-2 border-[${condColor}] ring-2 ring-[${condColor}]/40`
    : 'border border-slate-700 hover:border-slate-500';

  return (
    <button
      onClick={onClick}
      className={`group relative w-full text-left rounded-xl p-4 bg-slate-800 transition-all duration-200 ${
        isSelected ? 'ring-2 ring-white/20' : 'hover:bg-slate-750'
      } focus:outline-none focus:ring-2 focus:ring-slate-400`}
      style={{
        borderWidth: '2px',
        borderStyle: 'solid',
        borderColor: isSelected ? condColor : '#334155',
      }}
      aria-pressed={isSelected}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-bold text-lg leading-tight truncate">{name}</h3>
          <p className="text-slate-400 text-xs mt-0.5 truncate">{description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {current && (
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full"
              style={{ backgroundColor: condColor + '33', color: condColor }}
            >
              {conditionLabels[condition]}
            </span>
          )}
          {current && (
            <ShareMenu
              message={formatStationMessage(name, description, current, getAppUrl())}
              label={`Share ${name}`}
            />
          )}
          {onRemove && (
            <span
              role="button"
              aria-label={`Remove ${name}`}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove "${name}" from your stations?`)) onRemove(id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm(`Remove "${name}" from your stations?`)) onRemove(id);
                }
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/60 text-slate-400 hover:bg-red-900/80 hover:text-white transition cursor-pointer text-sm leading-none"
            >
              ×
            </span>
          )}
        </div>
      </div>

      {current ? (
        <>
          {/* Wind speed */}
          <div
            className="flex items-baseline gap-1 mb-2"
            title={windIsForecast ? 'Wind values are forecast (this station has no wind sensor)' : undefined}
          >
            <span
              className="text-3xl font-bold tabular-nums"
              style={{ color: condColor }}
            >
              {windIsForecast ? '~' : ''}
              {avgWind.toFixed(1)}
            </span>
            <span className="text-slate-400 text-sm">m/s avg</span>
            <span className="text-slate-500 mx-1">|</span>
            <span className="text-xl font-semibold text-slate-300 tabular-nums">
              {windIsForecast ? '~' : ''}
              {gust.toFixed(1)}
            </span>
            <span className="text-slate-400 text-sm">gust</span>
            <span
              className={`ml-1 text-sm font-semibold ${
                trend === 'building'
                  ? 'text-green-400'
                  : trend === 'dropping'
                  ? 'text-orange-400'
                  : 'text-slate-400'
              }`}
              title={`Trend: ${trend} (${trendRate.toFixed(1)} m/s per hour)`}
            >
              {trendIcons[trend]}
              {trend !== 'steady' && (
                <span className="ml-0.5 tabular-nums">
                  {trendRate > 0 ? '+' : ''}
                  {trendRate.toFixed(1)}/h
                </span>
              )}
            </span>
          </div>

          {/* Direction */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1">
              <svg
                className="w-4 h-4 text-slate-300"
                viewBox="0 0 24 24"
                fill="currentColor"
                /* heading = where the wind comes FROM. The arrow points to where it's going,
                   so we rotate by heading + 180°. */
                style={{ transform: `rotate(${(heading + 180) % 360}deg)` }}
              >
                <path d="M12 2L8 20l4-3 4 3z" />
              </svg>
              <span className="font-mono font-semibold text-slate-200">{compassDir}</span>
              <span className="text-slate-400 text-sm">{heading}°</span>
            </div>

            {/* Gustiness */}
            <span className={`text-sm font-medium ${gustColors[gustLevel]}`}>
              {gustLabels[gustLevel]}
            </span>
          </div>

          {/* Gear hint — only shown when conditions are foilable */}
          {(wing || wetsuit) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-xs text-slate-300">
              {wing && (
                <span title="Suggested wing/sail size">
                  <span className="text-slate-500">Wing:</span> {wing}
                </span>
              )}
              {wetsuit && (
                <span title="Suggested wetsuit">
                  <span className="text-slate-500">Suit:</span> {wetsuit}
                </span>
              )}
            </div>
          )}

          {/* Air + Water temp + Daylight + Updated — wraps on narrow widths */}
          <div className="flex flex-wrap items-center justify-between mt-2 gap-x-3 gap-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              {current.airTemp !== undefined && (
                <span title={airTempIsForecast ? 'Air temperature (forecast)' : 'Air temperature (measured)'}>
                  🌡️ {airTempIsForecast ? '~' : ''}
                  {current.airTemp.toFixed(1)}°C
                </span>
              )}
              {current.waterTemp !== undefined && (
                <span title="Water temperature">🌊 {current.waterTemp.toFixed(1)}°C</span>
              )}
              {daylight && (
                <span
                  title={`Sunset ${daylight.sunset.slice(11, 16)}`}
                  className={daylight.isDay ? '' : 'text-slate-500'}
                >
                  {daylight.isDay ? '🌅' : '🌙'} {formatDaylightRemaining(daylight)}
                </span>
              )}
            </div>
            <span className="text-slate-500 text-xs whitespace-nowrap">
              Updated {formatUpdated(current.updatedAt)}
            </span>
          </div>
        </>
      ) : (
        <div className="text-slate-500 text-sm py-2">
          <p className="mb-1">No real-time data</p>
          <p className="text-xs">Forecast only</p>
        </div>
      )}
    </button>
  );
}
