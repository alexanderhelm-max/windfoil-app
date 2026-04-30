'use client';

import { VivaObservation } from '@/lib/viva';
import { SmhiObsHistory } from '@/lib/smhi';
import {
  getCondition,
  getGustLevel,
  getTrend,
  headingToCompass,
  conditionColors,
  conditionLabels,
  trendIcons,
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
}: StationCardProps) {
  const avgWind = current?.avgWind ?? 0;
  const gust = current?.gust ?? 0;
  const heading = current?.heading ?? 0;

  const condition: ConditionLevel = getCondition(avgWind, heading);
  const gustLevel: GustLevel = getGustLevel(avgWind, gust);
  const trend = getTrend(recentObs);
  const compassDir = headingToCompass(heading);
  const condColor = conditionColors[condition];

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
      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
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
      </span>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-lg leading-tight">{name}</h3>
          <p className="text-slate-400 text-xs mt-0.5">{description}</p>
        </div>
        {current && (
          <span
            className="text-xs font-semibold px-2 py-1 rounded-full ml-2 shrink-0"
            style={{ backgroundColor: condColor + '33', color: condColor }}
          >
            {conditionLabels[condition]}
          </span>
        )}
      </div>

      {current ? (
        <>
          {/* Wind speed */}
          <div className="flex items-baseline gap-1 mb-2">
            <span
              className="text-3xl font-bold tabular-nums"
              style={{ color: condColor }}
            >
              {avgWind.toFixed(1)}
            </span>
            <span className="text-slate-400 text-sm">m/s avg</span>
            <span className="text-slate-500 mx-1">|</span>
            <span className="text-xl font-semibold text-slate-300 tabular-nums">
              {gust.toFixed(1)}
            </span>
            <span className="text-slate-400 text-sm">gust</span>
            <span className="text-xl ml-1" title={`Trend: ${trend}`}>
              {trendIcons[trend]}
            </span>
          </div>

          {/* Direction */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1">
              <svg
                className="w-4 h-4 text-slate-300"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ transform: `rotate(${heading}deg)` }}
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

          {/* Water temp + Updated */}
          <div className="flex items-center justify-between mt-2">
            {current.waterTemp !== undefined ? (
              <span className="text-slate-400 text-xs">
                🌊 {current.waterTemp.toFixed(1)}°C
              </span>
            ) : (
              <span />
            )}
            <span className="text-slate-500 text-xs">
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
