# Shetland Property Price Map

Interactive Leaflet map showing residential property sales across Shetland.

## Stack

Pure HTML/CSS/JS — no build step, no framework. Served as static files.

- **index.html** — shell, loads Leaflet + Leaflet.heat from CDN, then `data.js` and `app.js`
- **data.js** — exports a global `properties` array (generated/maintained separately)
- **app.js** — all map logic: markers, heatmap, search, year filter, info overlay
- **style.css** — all styling including mobile bottom sheet

Cache-busted via `?v=N` query params in index.html. Bump these when changing app.js or style.css.

## Data

`data.js` contains a `properties` array. Each entry:
```js
{ address: "14 HAYFIELD LANE, LERWICK, SHETLAND, ZE1 0QR", price: 125000, date: "2019-03-15", lat: 60.154, lng: -1.148 }
```

- Source: HM Land Registry / ScotLIS (see readme.md for API example)
- Coordinates are postcode-level (all properties sharing a postcode get the same lat/lng)
- The `jitter()` function offsets overlapping markers in circles so they're all clickable — this is a known visual artefact, not real positions

## Key features

- **Circle markers** colour-coded by price band (green < £100k through to red £275k+)
- **Heatmap layer** (toggleable)
- **Year range filter** — dual-handle slider, filters both markers and heatmap
- **Search** — filters by address/postcode substring
- **Info overlay** — "i" button opens full-screen overlay with description + average sale price by year table
- **Mobile** — bottom sheet for year filter + legend, responsive controls

## Info overlay price data

Average prices for historical years (2002–2025) are hardcoded in `app.js` to avoid recomputing on every load. Only the current year is computed live. When a new year's data is finalised, add it to the `yearStats` array and remove the live compute for the previous year.

## Conventions

- No icon libraries — all icons are pure CSS (the "i" button uses serif italic text)
- Leaflet controls positioned: search top-left, zoom + toggle + info top-right, legend bottom-right, year filter bottom-left
- Shadow pattern: `0 2px 12px rgba(0, 0, 0, 0.15)` used consistently
- Colours: blue accent `#2563eb`, price bands defined in `PRICE_BANDS` at top of app.js

## Deployment

Pushed to `master` on GitHub: `ShetlandJ/shetland-property-price-map`. No CI — just static files served via GitHub Pages.

**Keep it simple**: no build step, no node_modules, no bundlers. All code additions must work as plain static files. If a library is needed, load it via CDN — never introduce a build pipeline.
