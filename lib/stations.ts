export interface Station {
  id: string;
  name: string;
  description: string;
  vivaId: number | null;
  smhiObsId: number | null;
  lat: number;
  lon: number;
}

export const DEFAULT_STATIONS: Station[] = [
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
    lat: 57.697,
    lon: 11.855,
  },
  {
    id: 'viva-101',
    name: 'Torshamnen',
    description: 'Gothenburg harbour',
    vivaId: 101,
    smhiObsId: 71420,
    lat: 57.714,
    lon: 11.927,
  },
  {
    id: 'smhi-marstrand',
    name: 'Marstrand',
    description: 'Marstrand archipelago',
    vivaId: null,
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
