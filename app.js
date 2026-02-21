// Price bands and colors
const PRICE_BANDS = [
  { max: 100000, color: "#22c55e", label: "Under £100k" },
  { max: 150000, color: "#84cc16", label: "£100k – £150k" },
  { max: 200000, color: "#eab308", label: "£150k – £200k" },
  { max: 275000, color: "#f97316", label: "£200k – £275k" },
  { max: Infinity, color: "#ef4444", label: "£275k+" },
];

function getPriceBand(price) {
  return PRICE_BANDS.find((band) => price <= band.max);
}

function formatPrice(price) {
  return "£" + price.toLocaleString("en-GB");
}

// Initialize map centered on Shetland
const map = L.map("map", {
  center: [60.39, -1.14],
  zoom: 10,
  zoomControl: false,
});

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 18,
}).addTo(map);

// --- Jitter overlapping markers ---
// Properties sharing a postcode have identical coords; offset them so all are visible
const coordCounts = {};
properties.forEach((p) => {
  const key = `${p.lat},${p.lng}`;
  coordCounts[key] = (coordCounts[key] || 0) + 1;
});

function jitter(lat, lng, index, total) {
  if (total <= 1) return [lat, lng];
  const angle = (2 * Math.PI * index) / total;
  const radius = 0.0002 + 0.00005 * Math.floor(index / 8); // ~20m, expand in rings
  return [lat + radius * Math.sin(angle), lng + radius * Math.cos(angle)];
}

const coordIndex = {};

// --- Marker layer ---
const markerLayer = L.layerGroup();
const propertyMarkers = []; // parallel array: propertyMarkers[i] corresponds to properties[i]

properties.forEach((p, i) => {
  const key = `${p.lat},${p.lng}`;
  const idx = coordIndex[key] = (coordIndex[key] || 0);
  coordIndex[key]++;
  const [jLat, jLng] = jitter(p.lat, p.lng, idx, coordCounts[key]);
  const band = getPriceBand(p.price);
  const marker = L.circleMarker([jLat, jLng], {
    radius: 6,
    fillColor: band.color,
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillOpacity: 0.85,
  });
  marker._origStyle = { fillColor: band.color, color: "#fff", weight: 2, radius: 6 };

  const dateStr = p.date
    ? new Date(p.date).toLocaleDateString("en-GB", { year: "numeric", month: "short" })
    : "";

  marker.bindPopup(`
    <div class="popup-price">${formatPrice(p.price)}</div>
    <div class="popup-address">${p.address}</div>
    ${dateStr ? `<div class="popup-details"><span>Sold ${dateStr}</span></div>` : ""}
  `);

  markerLayer.addLayer(marker);
  propertyMarkers[i] = marker;
});

markerLayer.addTo(map);

// --- Heatmap layer ---
const maxPrice = properties.reduce((max, p) => Math.max(max, p.price), 0);
const heatData = properties.map((p) => [p.lat, p.lng, p.price / maxPrice]);

const heatLayer = L.heatLayer(heatData, {
  radius: 35,
  blur: 25,
  maxZoom: 13,
  gradient: {
    0.0: "#22c55e",
    0.3: "#84cc16",
    0.5: "#eab308",
    0.7: "#f97316",
    1.0: "#ef4444",
  },
});

// --- Toggle control ---
const ToggleControl = L.Control.extend({
  options: { position: "topright" },

  onAdd() {
    const container = L.DomUtil.create("div", "toggle-control");
    container.innerHTML = `
      <h3>Layers</h3>
      <label><input type="checkbox" id="toggle-markers" checked> Markers</label>
      <label><input type="checkbox" id="toggle-heatmap"> Heatmap</label>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  },
});

new ToggleControl().addTo(map);

document.getElementById("toggle-markers").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.addLayer(markerLayer);
    applyYearFilter(); // re-apply so only in-range markers show
  } else {
    map.removeLayer(markerLayer);
  }
});

document.getElementById("toggle-heatmap").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.addLayer(heatLayer);
  } else {
    map.removeLayer(heatLayer);
  }
});

// --- Year filter ---
const yearMin = 2002;
const yearMax = new Date().getFullYear();

const YearFilterControl = L.Control.extend({
  options: { position: "bottomleft" },

  onAdd() {
    const container = L.DomUtil.create("div", "year-filter-control");
    container.innerHTML = `
      <h3>Year Range</h3>
      <div class="year-slider-label">
        <span id="year-label">${yearMin} – ${yearMax}</span>
        <span id="year-count">${properties.length} properties</span>
      </div>
      <div class="year-slider-wrap">
        <input type="range" id="year-min" min="${yearMin}" max="${yearMax}" value="${yearMin}" step="1" />
        <input type="range" id="year-max" min="${yearMin}" max="${yearMax}" value="${yearMax}" step="1" />
      </div>
      <div class="year-slider-ticks">
        <span>${yearMin}</span>
        <span>${yearMax}</span>
      </div>
    `;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  },
});

new YearFilterControl().addTo(map);

const yearMinInput = document.getElementById("year-min");
const yearMaxInput = document.getElementById("year-max");
const yearLabel = document.getElementById("year-label");
const yearCount = document.getElementById("year-count");

function getPropertyYear(p) {
  if (!p.date) return null;
  return new Date(p.date).getFullYear();
}

function applyYearFilter() {
  let lo = parseInt(yearMinInput.value);
  let hi = parseInt(yearMaxInput.value);

  // Prevent handles from crossing
  if (lo > hi) {
    lo = hi;
    yearMinInput.value = lo;
  }

  yearLabel.textContent = `${lo} – ${hi}`;

  const filteredHeatData = [];
  let visibleCount = 0;

  properties.forEach((p, i) => {
    const year = getPropertyYear(p);
    const inRange = year !== null && year >= lo && year <= hi;
    const marker = propertyMarkers[i];

    if (inRange) {
      if (!markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
      filteredHeatData.push([p.lat, p.lng, p.price / maxPrice]);
      visibleCount++;
    } else {
      if (markerLayer.hasLayer(marker)) markerLayer.removeLayer(marker);
    }
  });

  yearCount.textContent = `${visibleCount} propert${visibleCount === 1 ? "y" : "ies"}`;
  heatLayer.setLatLngs(filteredHeatData);
}

yearMinInput.addEventListener("input", applyYearFilter);
yearMaxInput.addEventListener("input", applyYearFilter);

// --- Average price per year ---
// Historical years are hardcoded since the data won't change.
// Only the current year is computed live.
const yearStats = [
  { year: 2002, avg: 17667, count: 3 },
  { year: 2003, avg: 53318, count: 73 },
  { year: 2004, avg: 86314, count: 117 },
  { year: 2005, avg: 70755, count: 107 },
  { year: 2006, avg: 89059, count: 160 },
  { year: 2007, avg: 108139, count: 128 },
  { year: 2008, avg: 124249, count: 142 },
  { year: 2009, avg: 99662, count: 93 },
  { year: 2010, avg: 120508, count: 122 },
  { year: 2011, avg: 120962, count: 128 },
  { year: 2012, avg: 130711, count: 133 },
  { year: 2013, avg: 116206, count: 171 },
  { year: 2014, avg: 130055, count: 194 },
  { year: 2015, avg: 151435, count: 193 },
  { year: 2016, avg: 140430, count: 208 },
  { year: 2017, avg: 149293, count: 237 },
  { year: 2018, avg: 155964, count: 230 },
  { year: 2019, avg: 151556, count: 229 },
  { year: 2020, avg: 158903, count: 205 },
  { year: 2021, avg: 163455, count: 250 },
  { year: 2022, avg: 178753, count: 264 },
  { year: 2023, avg: 182016, count: 221 },
  { year: 2024, avg: 192248, count: 254 },
  { year: 2025, avg: 194161, count: 260 },
];

// Compute current year live (partial data)
const currentYear = new Date().getFullYear();
let cyTotal = 0, cyCount = 0;
properties.forEach((p) => {
  if (getPropertyYear(p) === currentYear) { cyTotal += p.price; cyCount++; }
});
if (cyCount > 0) {
  yearStats.push({ year: currentYear, avg: Math.round(cyTotal / cyCount), count: cyCount });
}

// --- Info button + overlay ---
const InfoControl = L.Control.extend({
  options: { position: "topright" },

  onAdd() {
    const container = L.DomUtil.create("div", "info-button-control");
    container.innerHTML = '<button class="info-btn" aria-label="About this map">i</button>';
    L.DomEvent.disableClickPropagation(container);
    container.querySelector(".info-btn").addEventListener("click", () => {
      document.getElementById("info-overlay").classList.add("open");
    });
    return container;
  },
});

new InfoControl().addTo(map);

// Build overlay DOM
const infoOverlay = document.createElement("div");
infoOverlay.id = "info-overlay";
infoOverlay.innerHTML = `
  <div class="info-overlay-inner">
    <div class="info-header">
      <h2>About This Map</h2>
      <button class="info-close-btn" aria-label="Close">&times;</button>
    </div>
    <p class="info-description">
      This map shows residential property sales in Shetland, sourced from
      HM Land Registry Price Paid data. It covers transactions from 2002 to
      the present. Each marker represents a sold property, coloured by sale
      price. Use the year filter and search to explore the data.
    </p>
    <h3>Average Sale Price by Year</h3>
    <table class="info-table">
      <thead><tr><th>Year</th><th>Avg Price</th><th>Sales</th></tr></thead>
      <tbody>
        ${yearStats.map((s) => `<tr><td>${s.year}</td><td class="price-cell">${formatPrice(s.avg)}</td><td>${s.count}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>
`;
document.body.appendChild(infoOverlay);

infoOverlay.querySelector(".info-close-btn").addEventListener("click", () => {
  infoOverlay.classList.remove("open");
});

// --- Legend ---
const LegendControl = L.Control.extend({
  options: { position: "bottomright" },

  onAdd() {
    const container = L.DomUtil.create("div", "legend-control");
    const items = PRICE_BANDS.map(
      (band) => `
      <div class="legend-item">
        <div class="legend-color" style="background: ${band.color}"></div>
        ${band.label}
      </div>`
    ).join("");

    container.innerHTML = `<h3>Price</h3>${items}`;

    L.DomEvent.disableClickPropagation(container);
    return container;
  },
});

new LegendControl().addTo(map);

// --- Search ---
const SearchControl = L.Control.extend({
  options: { position: "topleft" },

  onAdd() {
    const container = L.DomUtil.create("div", "search-control");
    container.innerHTML = `
      <input type="text" id="search-input" placeholder="Search address or postcode..." />
      <div id="search-results"></div>
    `;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  },
});

new SearchControl().addTo(map);

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let highlightedMarkers = [];

function clearHighlights() {
  highlightedMarkers.forEach((m) => {
    m.setStyle({ fillColor: m._origStyle.fillColor, color: m._origStyle.color, weight: m._origStyle.weight });
    m.setRadius(m._origStyle.radius);
  });
  highlightedMarkers = [];
}

function highlightMarker(marker) {
  marker.setStyle({ fillColor: "#2563eb", color: "#fff", weight: 3 });
  marker.setRadius(10);
  highlightedMarkers.push(marker);
}

function goToResult(index) {
  clearHighlights();
  const marker = propertyMarkers[index];
  // Ensure marker is visible even if outside year filter
  if (!markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
  if (!map.hasLayer(markerLayer)) map.addLayer(markerLayer);
  const latlng = marker.getLatLng();
  map.setView(latlng, 17);
  highlightMarker(marker);
  marker.openPopup();
  searchResults.style.display = "none";
}

let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(doSearch, 200);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchInput.value = "";
    searchResults.style.display = "none";
    clearHighlights();
  }
});

function normalize(str) {
  return str.toLowerCase().replace(/[.,]/g, "");
}

function doSearch() {
  const query = normalize(searchInput.value.trim());
  searchResults.style.display = "none";
  clearHighlights();

  if (query.length < 3) return;

  const matches = [];
  properties.forEach((p, i) => {
    if (normalize(p.address).includes(query)) {
      matches.push(i);
    }
  });

  if (matches.length === 0) {
    searchResults.innerHTML = '<div class="search-empty">No results found</div>';
    searchResults.style.display = "block";
    return;
  }

  if (matches.length === 1) {
    goToResult(matches[0]);
    return;
  }

  // Multiple results — show list (cap at 50)
  const shown = matches.slice(0, 50);
  searchResults.innerHTML = shown.map((i) => {
    const p = properties[i];
    const dateStr = p.date ? new Date(p.date).toLocaleDateString("en-GB", { year: "numeric", month: "short" }) : "";
    return `<div class="search-item" data-index="${i}">
      <span class="search-item-address">${p.address}</span>
      <span class="search-item-meta">${formatPrice(p.price)}${dateStr ? " &middot; " + dateStr : ""}</span>
    </div>`;
  }).join("");

  if (matches.length > 50) {
    searchResults.innerHTML += `<div class="search-empty">${matches.length - 50} more results...</div>`;
  }

  searchResults.style.display = "block";

  searchResults.querySelectorAll(".search-item").forEach((el) => {
    el.addEventListener("click", () => {
      goToResult(parseInt(el.dataset.index));
    });
  });
}

// --- Mobile bottom sheet for year filter ---
if (window.matchMedia('(max-width: 600px)').matches) {
  // Hide the Leaflet year filter and legend controls directly via JS
  const leafletYearControl = document.querySelector('.year-filter-control');
  if (leafletYearControl) leafletYearControl.style.display = 'none';
  const leafletLegendControl = document.querySelector('.legend-control');
  if (leafletLegendControl) leafletLegendControl.style.display = 'none';

  // Trigger button
  const trigger = document.createElement('button');
  trigger.id = 'year-filter-trigger';
  trigger.innerHTML = `<span id="trigger-text">${yearMin} – ${yearMax} | ${properties.length}</span><span class="chevron">&#9650;</span>`;
  document.body.appendChild(trigger);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'year-sheet-backdrop';
  document.body.appendChild(backdrop);

  // Bottom sheet
  const sheet = document.createElement('div');
  sheet.id = 'year-sheet';
  sheet.innerHTML = `
    <div class="sheet-header">
      <h3>Year Range</h3>
      <button class="sheet-done-btn">Done</button>
    </div>
    <div class="sheet-label-row">
      <span id="sheet-year-label">${yearMin} – ${yearMax}</span>
      <span id="sheet-year-count">${properties.length} properties</span>
    </div>
    <div class="sheet-slider-wrap">
      <input type="range" id="sheet-year-min" min="${yearMin}" max="${yearMax}" value="${yearMinInput.value}" step="1" />
      <input type="range" id="sheet-year-max" min="${yearMin}" max="${yearMax}" value="${yearMaxInput.value}" step="1" />
    </div>
    <div class="sheet-ticks">
      <span>${yearMin}</span>
      <span>${yearMax}</span>
    </div>
    <div class="sheet-legend">
      <h3>Price</h3>
      <div class="sheet-legend-items">
        ${PRICE_BANDS.map(band => `<div class="sheet-legend-item"><span class="sheet-legend-color" style="background:${band.color}"></span>${band.label}</div>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(sheet);

  const sheetMinInput = document.getElementById('sheet-year-min');
  const sheetMaxInput = document.getElementById('sheet-year-max');
  const sheetLabel = document.getElementById('sheet-year-label');
  const sheetCount = document.getElementById('sheet-year-count');
  const triggerText = document.getElementById('trigger-text');
  const doneBtn = sheet.querySelector('.sheet-done-btn');

  function openSheet() {
    sheet.classList.add('open');
    backdrop.classList.add('open');
  }

  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
  }

  trigger.addEventListener('click', openSheet);
  backdrop.addEventListener('click', closeSheet);
  doneBtn.addEventListener('click', closeSheet);

  function syncSheetToFilter() {
    // Copy sheet values to the hidden Leaflet inputs
    yearMinInput.value = sheetMinInput.value;
    yearMaxInput.value = sheetMaxInput.value;
    applyYearFilter();

    // Update sheet labels
    const lo = yearMinInput.value;
    const hi = yearMaxInput.value;
    sheetLabel.textContent = `${lo} – ${hi}`;
    sheetCount.textContent = yearCount.textContent;
    triggerText.textContent = `${lo} – ${hi} | ${yearCount.textContent.split(' ')[0]}`;
  }

  sheetMinInput.addEventListener('input', syncSheetToFilter);
  sheetMaxInput.addEventListener('input', syncSheetToFilter);

  // Also patch applyYearFilter so trigger stays in sync when called externally
  const _origApply = applyYearFilter;
  applyYearFilter = function () {
    _origApply();
    const lo = yearMinInput.value;
    const hi = yearMaxInput.value;
    sheetMinInput.value = lo;
    sheetMaxInput.value = hi;
    sheetLabel.textContent = `${lo} – ${hi}`;
    sheetCount.textContent = yearCount.textContent;
    triggerText.textContent = `${lo} – ${hi} | ${yearCount.textContent.split(' ')[0]}`;
  };
}
