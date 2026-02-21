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

// --- Marker layer ---
const markerLayer = L.layerGroup();

properties.forEach((p) => {
  const band = getPriceBand(p.price);
  const marker = L.circleMarker([p.lat, p.lng], {
    radius: 10,
    fillColor: band.color,
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillOpacity: 0.85,
  });

  marker.bindPopup(`
    <div class="popup-price">${formatPrice(p.price)}</div>
    <div class="popup-address">${p.address}</div>
    <div class="popup-details">
      <span>${p.type}</span>
      <span>${p.bedrooms} bed</span>
    </div>
  `);

  markerLayer.addLayer(marker);
});

markerLayer.addTo(map);

// --- Heatmap layer ---
const maxPrice = Math.max(...properties.map((p) => p.price));
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
