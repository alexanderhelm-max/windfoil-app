const VIVA_BASE = 'https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc/vivastation';

interface VivaSample {
  Name: string;
  Value: string;
  Heading: number;
  Unit: string;
  Type: string;
  Updated: string;
  Quality: string;
}

// Value format is "V 3.6" or "SV 7.5" — last space-separated token is the number
function parseVivaValue(str: string): number {
  if (!str) return 0;
  const parts = str.trim().split(' ');
  return parseFloat(parts[parts.length - 1]) || 0;
}

export interface VivaObservation {
  avgWind: number;
  gust: number;
  heading: number;
  updatedAt: string;
  waterTemp?: number;
  airTemp?: number;
}

export async function fetchVivaStation(id: number): Promise<VivaObservation | null> {
  try {
    const res = await fetch(`${VIVA_BASE}/${id}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const samples: VivaSample[] = data?.GetSingleStationResult?.Samples ?? [];
    if (samples.length === 0) return null;

    const medelvind = samples.find((s) => s.Name === 'Medelvind');
    const byvind = samples.find((s) => s.Name === 'Byvind');
    // Water temp varies by station: "Vattentemp" (surface), "Vattentemp 3m" (near-surface),
    // "Vattentemp Botten" (bottom — skip, not surface relevant)
    const vattentemp =
      samples.find((s) => s.Name === 'Vattentemp') ??
      samples.find((s) => s.Name === 'Vattentemp 3m') ??
      samples.find((s) => /^Vattentemp(?!.*Botten)/.test(s.Name));
    const lufttemp = samples.find((s) => s.Name === 'Lufttemp');

    if (!medelvind && !byvind) return null;

    const ref = medelvind ?? byvind!;

    return {
      avgWind: medelvind ? parseVivaValue(medelvind.Value) : 0,
      gust: byvind ? parseVivaValue(byvind.Value) : 0,
      heading: ref.Heading,
      updatedAt: ref.Updated,
      waterTemp: vattentemp ? parseFloat(vattentemp.Value) : undefined,
      airTemp: lufttemp ? parseFloat(lufttemp.Value) : undefined,
    };
  } catch {
    return null;
  }
}
