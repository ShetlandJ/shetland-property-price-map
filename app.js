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
