# Wind Foil Conditions

Real-time wind monitoring for windfoiling on the Swedish west coast (Varberg–Uddevalla).
Pulls live observations from VIVA (Sjöfartsverket) and 96-hour forecasts from Open-Meteo,
plus historical data from SMHI.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Adding stations

Use the "+ Add station" button in the UI. Three modes:
- **VIVA station** — pick from ~150 Swedish maritime stations (live wind + water temp)
- **SMHI station** — pick from SMHI's wind-speed network (history only)
- **Custom point** — any lat/lon (forecast only)

Stations are stored in your browser's localStorage and persist across reloads.

## Deploy

Push to GitHub, then click "Deploy" on vercel.com — pick the repo, click Deploy. No env vars needed.

## Data sources

- [VIVA / Sjöfartsverket](https://viva.sjofartsverket.se) — real-time wind & water temp
- [SMHI Open Data](https://opendata.smhi.se) — 24h historical wind observations
- [Open-Meteo](https://open-meteo.com) — 96h hourly wind forecast
