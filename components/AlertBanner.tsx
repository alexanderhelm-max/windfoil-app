'use client';

import { useEffect, useRef } from 'react';
import { ConditionLevel, conditionLabels } from '@/lib/wind-utils';

interface StationAlert {
  name: string;
  condition: ConditionLevel;
  avgWind: number;
}

interface AlertBannerProps {
  greatStations: StationAlert[];
}

export default function AlertBanner({ greatStations }: AlertBannerProps) {
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (greatStations.length === 0 || notifiedRef.current) return;
    notifiedRef.current = true;

    if (!('Notification' in window)) return;

    const sendNotification = () => {
      const stationList = greatStations.map((s) => `${s.name}: ${s.avgWind.toFixed(1)} m/s`).join(', ');
      const body = `${greatStations.length} station${greatStations.length > 1 ? 's' : ''} with great conditions: ${stationList}`;
      try {
        new Notification('Wind Foil Conditions', { body, icon: '/favicon.ico' });
      } catch {
        // Notification may fail silently
      }
    };

    if (Notification.permission === 'granted') {
      sendNotification();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') sendNotification();
      });
    }
  }, [greatStations]);

  if (greatStations.length === 0) return null;

  return (
    <div className="bg-green-900/40 border border-green-700 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
      <span className="text-2xl leading-none mt-0.5">🌊</span>
      <div>
        <p className="font-semibold text-green-300 mb-0.5">
          Great conditions right now!
        </p>
        <p className="text-green-400/80 text-sm">
          {greatStations.map((s) => (
            <span key={s.name} className="inline-block mr-3">
              <strong>{s.name}</strong>:{' '}
              <span style={{ color: '#22c55e' }}>{conditionLabels[s.condition]}</span>{' '}
              {s.avgWind.toFixed(1)} m/s
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
