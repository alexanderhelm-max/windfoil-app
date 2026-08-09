export interface Spot {
  id: string;
  name: string;
  description: string;
  vivaId: number | null;
  smhiObsId: number | null;
  /** Holfuy station id (holfuy.com) — spot-mounted community wind stations.
   *  Requires HOLFUY_API_KEY on the server to be used. */
  holfuyId?: number | null;
  lat: number;
  lon: number;
}

export const DEFAULT_SPOTS: Spot[] = [
  {
    id: 'viva-220',
    name: 'Nidingen',
    description: 'Off Varberg coast',
    vivaId: 220,
    smhiObsId: 71190,
    lat: 57.303,
    lon: 11.904,
  },
  {
    id: 'viva-114',
    name: 'Vinga',
    description: 'Outer Gothenburg',
    vivaId: 114,
    smhiObsId: 71380,
    lat: 57.632,
    lon: 11.605,
  },
  {
    id: 'viva-99',
    name: 'Karet',
    description: 'Gothenburg north',
    vivaId: 99,
    smhiObsId: 71420,
    // Coordinates of VIVA station 99 "Karet (GBG Hamn)" so forecast and
    // daylight are computed where the wind is actually measured.
    lat: 57.68775,
    lon: 11.869629,
  },
  {
    id: 'viva-101',
    name: 'Torshamnen',
    description: 'Gothenburg harbour',
    vivaId: 101,
    smhiObsId: 71420,
    // Coordinates of VIVA station 101 "Torshamnen (GBG Hamn)". The previous
    // values (57.714, 11.927) pointed at central Gothenburg, 9 km from the
    // station, so forecasts were fetched for the wrong place.
    lat: 57.681105,
    lon: 11.7881,
  },
  {
    id: 'smhi-marstrand',
    name: 'Marstrand',
    description: 'Marstrand archipelago',
    // VIVA station 182 "Skallen", 1.4 km from the spot — reports live wind.
    vivaId: 182,
    smhiObsId: null,
    lat: 57.889,
    lon: 11.582,
  },
  {
    id: 'smhi-lysekil',
    name: 'Lysekil',
    description: 'Lysekil area',
    vivaId: null,
    smhiObsId: null,
    lat: 58.273,
    lon: 11.435,
  },
];
