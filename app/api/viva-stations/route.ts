import { NextResponse } from 'next/server';

interface VivaStationRaw {
  ID: number;
  Name: string;
  Lat?: number;
  Lon?: number;
}

interface VivaStationsResponse {
  GetStationsResult?: {
    Stations?: VivaStationRaw[];
  };
}

export async function GET() {
  try {
    // Trailing slash AND Accept: application/json are both required;
    // without them the WCF service returns an HTML help page instead of JSON.
    const res = await fetch(
      'https://services.viva.sjofartsverket.se:8080/output/vivaoutputservice.svc/vivastation/',
      {
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      }
    );
    if (!res.ok) return NextResponse.json({ stations: [] });
    const data = (await res.json()) as VivaStationsResponse;
    const list = data?.GetStationsResult?.Stations ?? [];
    const stations = list
      .map((s) => ({
        id: s.ID,
        name: s.Name,
        lat: s.Lat ?? null,
        lon: s.Lon ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    return NextResponse.json({ stations });
  } catch {
    return NextResponse.json({ stations: [] });
  }
}
