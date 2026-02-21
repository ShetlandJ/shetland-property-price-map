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
