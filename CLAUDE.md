# Shetland Property Price Map

Interactive Leaflet map showing residential property sales across Shetland.

## Stack

Pure HTML/CSS/JS — no build step, no framework. Served as static files.

- **index.html** — shell, loads Leaflet + Leaflet.heat + Chart.js from CDN, then `data.js` and `app.js`
- **data.js** — exports a global `properties` array (generated/maintained separately)
- **app.js** — all map logic: markers, heatmap, search, year filter, info overlay, reports
- **style.css** — all styling including mobile bottom sheet, popups, report accordions

Cache-busted via `?v=N` query params in index.html. Bump these when changing app.js or style.css.

## Data

`data.js` contains a `properties` array. Each entry represents a single sale:
```js
{ lat: 60.154, lng: -1.148, price: 125000, address: "14 HAYFIELD LANE, LERWICK, SHETLAND, ZE1 0QR", date: "2019-03-15" }
```

Entries with no numeric price have `price: null` and a `note` field:
```js
{ lat: 60.154, lng: -1.148, price: null, address: "...", date: "2023-03-30", note: "No price available" }
```

The same address can appear multiple times (one entry per sale).

- Source: ScotLIS (Registers of Scotland) — see readme.md for API example
- Coordinates are postcode-level (all properties sharing a postcode get the same lat/lng)

## Data Fetching

`fetch_data.js` pulls data from the ScotLIS API for all valid ZE postcodes:

```sh
node fetch_data.js              # Start or resume fetching
node fetch_data.js --export     # Export cached data to data.js
node fetch_data.js --stats      # Show progress stats
```

- Rate limited: 18–23 second random delay between requests
- Progress cached in `cache/` directory (resumable if interrupted)
- Takes ~5 hours for all Shetland postcodes
- Captures ALL titles per address (repeat sales, "No price available", "Love Favour and Affection", etc.)
- The `cache/` directory is gitignored

## Architecture

### Address grouping

Properties are **grouped by address** at startup into a `groups` array (`Map<address, { lat, lng, sales[] }>`). Each group gets **one marker** on the map. Clicking a marker shows the full sale history for that address in the popup. This replaced the old 1-marker-per-sale approach.

- `groups` — one entry per unique address, sales sorted newest-first
- `groupMarkers[]` — parallel array of Leaflet markers, one per group
- `addressToGroupIndex{}` — address string → group index lookup (used for job lot links)

### Job lot detection

Job lots are detected at runtime (not flagged in `data.js`). The logic: if 2+ different addresses at the **same postcode** (same lat/lng) sold for the **same price** on the **same date**, they're flagged `jobLot: true` with a `_jobLotKey`. This catches bulk purchases like 9 Mulla properties all at £870k.

Note: the recorded price is the **lot price** (total for the whole bundle), not per-property. The per-property price is calculated as `lotPrice / count`.

### Report data

- `reportSales` — one entry per address, the most recent **non-job-lot** priced sale. Used for price distribution, area stats, top 10 table, summary cards (total value, median). This prevents job lots from skewing averages and prevents multi-sale addresses from being counted multiple times.
- `properties` (raw array) — still used for total sales count, monthly stats, and anything where every individual transaction matters.
- `yearStats` — hardcoded historical averages (2002–2025), only current year computed live.

## Key features

- **Circle markers** colour-coded by price band (green < £100k through to red £275k+)
- **Grouped by address** — one marker per address, popup shows full sale history
- **Heatmap layer** (toggleable) — one heat point per address group
- **Year range filter** — dual-handle slider, shows marker if any sale in range, counts individual sales
- **Search** — deduplicated by address, shows latest price + sale count
- **Job lot detection** — runtime detection, badge in popups, clickable links to related properties
- **Info overlay** — two tabs: About and Reports
- **Reports tab** — collapsible accordion sections, all start collapsed:
  - Summary cards (total sales, total value, median, price change, job lot count)
  - Average Sale Price by Year (chart + table)
  - Year-on-Year Price Change
  - Number of Sales per Year
  - Total Market Value by Year
  - Sales by Month
  - Sales by Price Band
  - Average Price by Area
  - Top 10 Most Expensive Sales
  - Job Lot Sales (summary cards + accordion panels with linked addresses)
- **Mobile** — bottom sheet for year filter + legend, responsive controls

### Jitter

The `jitter()` function offsets overlapping markers in circles so all are clickable. Jitter is based on unique **addresses** per postcode (not individual sales). This is a known visual artefact, not real positions.

## Info overlay price data

Average prices for historical years (2002–2025) are hardcoded in `app.js` to avoid recomputing on every load. Only the current year is computed live. When a new year's data is finalised, add it to the `yearStats` array and remove the live compute for the previous year.

## Conventions

- No icon libraries — all icons are pure CSS (the "i" button uses serif italic text)
- Leaflet controls positioned: search top-left, zoom + toggle + info top-right, legend bottom-right, year filter bottom-left
- Shadow pattern: `0 2px 12px rgba(0, 0, 0, 0.15)` used consistently
- Colours: blue accent `#2563eb`, price bands defined in `PRICE_BANDS` at top of app.js
- Helper functions: `formatPrice()` for full prices (£125,000), `formatShortPrice()` for compact (£125k, £1.2m)
- Collapsible UI pattern: `.report-collapse` for report sections, `.jl-panel` for job lot accordion — both use `open` class toggle with chevron rotation

## Deployment

Pushed to `master` on GitHub: `ShetlandJ/shetland-property-price-map`. No CI — just static files served via GitHub Pages.

**Keep it simple**: no build step, no node_modules, no bundlers. All code additions must work as plain static files. If a library is needed, load it via CDN — never introduce a build pipeline.
