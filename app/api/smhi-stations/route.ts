import { NextResponse } from 'next/server';

interface SmhiStationRaw {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  active?: boolean;
}

interface SmhiStationsResponse {
  station?: SmhiStationRaw[];
}

export async function GET() {
  try {
    const res = await fetch(
      'https://opendata-download-metobs.smhi.se/api/version/latest/parameter/4.json',
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return NextResponse.json({ stations: [] });
    const data = (await res.json()) as SmhiStationsResponse;
    const stations = (data.station ?? [])
      .filter((s) => s.active !== false)
      .map((s) => ({
        id: Number(s.key),
        name: s.name,
        lat: s.latitude,
        lon: s.longitude,
      }));
    return NextResponse.json({ stations });
  } catch {
    return NextResponse.json({ stations: [] });
  }
}
