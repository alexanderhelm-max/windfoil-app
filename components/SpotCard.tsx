'use client';

import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory } from '@/lib/smhi';
import {
  getCondition,
  getGustLevel,
  headingToCompass,
  conditionColors,
  conditionLabels,
  getWetsuitHint,
  getWingHint,
  ConditionLevel,
  GustLevel,
  WindSector,
} from '@/lib/wind-utils';
import { formatSpotMessage, getAppUrl } from '@/lib/share';
import ShareMenu from './ShareMenu';
import SectorRose from './SectorRose';
import { MarineNow, seaState } from '@/lib/marine';
import TrendBadge, { Trend } from './TrendBadge';

interface SpotCardProps {
  id: string;
  name: string;
  description: string;
  current: VivaObservation | null;
  history: SmhiObsHistory | null;
  /** Last-hour wind trend, or null when there isn't enough data to read one */
  trend: Trend | null;
  isSelected: boolean;
  onClick: () => void;
  onRemove?: (id: string) => void;
  /** Opens the compass editor for this spot's working directions */
  onEditSectors?: (id: string) => void;
  /** True when the air temp came from forecast rather than a real sensor */
  airTempIsForecast?: boolean;
  /** True when the wind values came from forecast (e.g. station with no wind sensor) */
  windIsForecast?: boolean;
  /** Set when the live reading came from a nearby station rather than this spot's own */
  currentStation?: { name: string; distanceKm: number } | null;
  /** Compass sectors this spot works in; undefined means grade on speed alone */
  goodSectors?: WindSector[];
  /** Sea state from the wave model; absent for sheltered spots */
  marine?: MarineNow | null;
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

export default function SpotCard({
  id,
  name,
  description,
  current,
  trend,
  isSelected,
  onClick,
  onRemove,
  onEditSectors,
  airTempIsForecast = false,
  windIsForecast = false,
  currentStation = null,
  goodSectors,
  marine,
}: SpotCardProps) {
  const avgWind = current?.avgWind ?? 0;
  const gust = current?.gust ?? 0;
  const heading = current?.heading ?? 0;

  const condition: ConditionLevel = getCondition(avgWind, heading, goodSectors);
  const gustLevel: GustLevel = getGustLevel(avgWind, gust);
  const compassDir = headingToCompass(heading);
  const condColor = conditionColors[condition];
  const wetsuit = getWetsuitHint(current?.waterTemp);
  const wing = getWingHint(avgWind);

  const borderStyle = isSelected
    ? `border-2 border-[${condColor}] ring-2 ring-[${condColor}]/40`
    : 'border border-slate-700 hover:border-slate-500';

  return (
    <div
      className={`group relative rounded-xl bg-slate-800 transition-all duration-200 ${
        isSelected ? 'ring-2 ring-white/20' : ''
      }`}
      style={{
        borderWidth: '2px',
        borderStyle: 'solid',
        borderColor: isSelected ? condColor : '#334155',
      }}
    >
      {/* Controls sit outside the select button. Nesting them inside it made
          them part of its accessible name, so a screen reader announced the
          card as "Nidingen … Share … Edit wind directions … Remove". */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
        {current && (
          <ShareMenu
            message={formatSpotMessage(name, description, current, getAppUrl(), goodSectors)}
            label={`Share ${name}`}
          />
        )}
        {onEditSectors && (
          <button
            type="button"
            aria-label={`Settings for ${name}`}
            title="Wind directions and wave settings"
            onClick={() => onEditSectors(id)}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition text-xs leading-none ${
              goodSectors && goodSectors.length > 0
                ? 'bg-green-900/50 text-green-300 hover:bg-green-800/70'
                : 'bg-slate-900/60 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            ⌖
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${name}`}
            onClick={() => {
              if (confirm(`Remove "${name}" from your spots?`)) onRemove(id);
            }}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/60 text-slate-400 hover:bg-red-900/80 hover:text-white transition text-sm leading-none"
          >
            ×
          </button>
        )}
      </div>

      <button
        onClick={onClick}
        aria-pressed={isSelected}
        aria-label={`${name} — show wind timeline`}
        className={`w-full text-left rounded-[10px] p-4 ${
          isSelected ? '' : 'hover:bg-slate-750'
        } focus:outline-none focus:ring-2 focus:ring-slate-400`}
      >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-bold text-lg leading-tight truncate">{name}</h3>
          <p className="text-slate-400 text-xs mt-0.5 truncate">{description}</p>
        </div>
        {current && (
          <span
            className="text-xs font-semibold px-2 py-1 rounded-full shrink-0 mr-24"
            style={{ backgroundColor: condColor + '33', color: condColor }}
          >
            {conditionLabels[condition]}
          </span>
        )}
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
            <span className="ml-1 text-sm">
              <TrendBadge trend={trend} />
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
              <SectorRose sectors={goodSectors} heading={heading} />
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

          {/* Air + Water temp + Updated — wraps on narrow widths */}
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
              {marine && (
                <span
                  title={
                    `Wave model (open sea), not measured at this spot.` +
                    (marine.swellHeight != null && marine.swellPeriod != null
                      ? ` Swell ${marine.swellHeight.toFixed(1)} m at ${marine.swellPeriod.toFixed(0)} s.`
                      : '')
                  }
                >
                  〜 {marine.waveHeight.toFixed(1)} m
                  {marine.wavePeriod != null && ` · ${marine.wavePeriod.toFixed(0)} s`}
                  {seaState(marine.wavePeriod) && (
                    <span className="text-slate-500"> {seaState(marine.wavePeriod)}</span>
                  )}
                </span>
              )}
            </div>
            <span className="text-slate-500 text-xs whitespace-nowrap">
              {currentStation && !windIsForecast && (
                <span
                  className="text-emerald-500/80 mr-1.5"
                  title={
                    currentStation.distanceKm < 0.5
                      ? `Measured at ${currentStation.name}, at this spot.`
                      : `Measured at ${currentStation.name}, ${currentStation.distanceKm.toFixed(0)} km away — no sensor at this spot.`
                  }
                >
                  via {currentStation.name}
                  {currentStation.distanceKm >= 0.5
                    ? ` ${currentStation.distanceKm.toFixed(0)} km`
                    : ''}{' '}
                  ·
                </span>
              )}
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
    </div>
  );
}
