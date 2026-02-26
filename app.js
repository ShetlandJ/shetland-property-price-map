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

// Delta bands for asking vs sold view (diverging blue → green → red)
const DELTA_BANDS = [
  { max: -10, color: "#1e40af", label: "10%+ under asking" },
  { max: -1,  color: "#60a5fa", label: "1–10% under" },
  { max: 1,   color: "#22c55e", label: "At asking (±1%)" },
  { max: 10,  color: "#f87171", label: "1–10% over" },
  { max: Infinity, color: "#991b1b", label: "10%+ over asking" },
];

function getDeltaBand(deltaPercent) {
  return DELTA_BANDS.find((band) => deltaPercent <= band.max);
}

function formatPrice(price) {
  return "£" + price.toLocaleString("en-GB");
}

function formatShortPrice(price) {
  if (price >= 1000000) return "£" + (price / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  if (price >= 1000) return "£" + Math.round(price / 1000) + "k";
  return "£" + price;
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

// --- Detect job lots: multiple different addresses at same postcode with same price on same date ---
const datePricePostcodeBuckets = new Map();
properties.forEach((p) => {
  if (p.price == null) return;
  const key = `${p.date}|${p.price}|${p.lat},${p.lng}`;
  if (!datePricePostcodeBuckets.has(key)) datePricePostcodeBuckets.set(key, new Set());
  datePricePostcodeBuckets.get(key).add(p.address);
});
properties.forEach((p) => {
  if (p.price == null) return;
  const key = `${p.date}|${p.price}|${p.lat},${p.lng}`;
  if (datePricePostcodeBuckets.get(key).size > 1) {
    p.jobLot = true;
    p._jobLotKey = key;
  }
});

// --- Group properties by address ---
const addressGroups = new Map();
properties.forEach((p) => {
  if (!addressGroups.has(p.address)) {
    addressGroups.set(p.address, { lat: p.lat, lng: p.lng, sales: [] });
  }
  addressGroups.get(p.address).sales.push(p);
});

// Sort each group's sales newest first
addressGroups.forEach((group) => {
  group.sales.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
});

const groups = Array.from(addressGroups.values());

// --- Area normalization ---
const AREA_NORMALIZE = {
  "G0TT": "GOTT",
  "GULBERICK": "GULBERWICK",
  "GERMISTA": "GREMISTA",
  "BALTASOUND UNST": "UNST",
  "EAST VOE SCALLOWAY": "SCALLOWAY",
  "HAMNAVOE BURRA": "BURRA",
  "BRIDGE END BURRA": "BURRA",
  "PAPIL BURRA": "BURRA",
  "WEST BURRAFIRTH": "BURRAFIRTH",
  "NORTH ROE": "NORTHROE",
  "MID YELL": "YELL",
  "WEST YELL": "YELL",
  "NORTH YELL": "YELL",
  "EAST YELL": "YELL",
};

function getArea(address) {
  const parts = address.split(",").map((s) => s.trim());
  const shetlandIdx = parts.findIndex((s) => s === "SHETLAND");
  let area = shetlandIdx > 0 ? parts[shetlandIdx - 1] : null;

  if (!area) {
    // Fallback: ZE1 postcodes without "SHETLAND" are typically Lerwick
    const postcode = parts[parts.length - 1];
    if (postcode && postcode.startsWith("ZE1")) return "LERWICK";
    area = parts[1] || "Unknown";
  }

  return AREA_NORMALIZE[area] || area;
}

// Tag each group with its normalized area
groups.forEach((g) => { g.area = getArea(g.sales[0].address); });

// Helper: most recent sale with a valid price
function getLatestPricedSale(sales) {
  return sales.find((s) => s.price != null) || sales[0];
}

// For reports: one entry per address, most recent non-job-lot priced sale
const reportSales = groups
  .map((g) => g.sales.find((s) => s.price != null && !s.jobLot))
  .filter((s) => s != null);

// Address to group index lookup (for job lot links)
const addressToGroupIndex = {};
groups.forEach((g, i) => { addressToGroupIndex[g.sales[0].address] = i; });

// --- Notable sales filter categories ---
const NOTABLE_FILTERS = [
  { key: "all", label: "All properties" },
  { key: "pound1", label: "£1 sales" },
  { key: "bargain", label: "Under £1k" },
  { key: "love", label: "Love, Favour & Affection" },
  { key: "good-causes", label: "Certain Good Causes" },
  { key: "top20", label: "Top 20 most expensive" },
];

// Pre-compute which group indices match each filter
const notableFilterSets = new Map();

notableFilterSets.set("pound1", new Set(
  groups.reduce((acc, g, i) => {
    if (g.sales.some(s => s.price === 1)) acc.push(i);
    return acc;
  }, [])
));

notableFilterSets.set("bargain", new Set(
  groups.reduce((acc, g, i) => {
    if (g.sales.some(s => s.price != null && s.price > 0 && s.price < 1000)) acc.push(i);
    return acc;
  }, [])
));

notableFilterSets.set("love", new Set(
  groups.reduce((acc, g, i) => {
    if (g.sales.some(s => s.note && s.note.toLowerCase().includes("love"))) acc.push(i);
    return acc;
  }, [])
));

notableFilterSets.set("good-causes", new Set(
  groups.reduce((acc, g, i) => {
    if (g.sales.some(s => s.note && s.note.toLowerCase().includes("certain good"))) acc.push(i);
    return acc;
  }, [])
));

// Top 20: from reportSales sorted by price desc, mapped back to group indices
const top20Sales = [...reportSales].sort((a, b) => b.price - a.price).slice(0, 20);
const top20Indices = new Set(top20Sales.map(s => addressToGroupIndex[s.address]).filter(i => i != null));
notableFilterSets.set("top20", top20Indices);

let activeNotableFilter = "all";

// Global function for job lot popup links
window.goToJobLotAddress = function (address) {
  const gi = addressToGroupIndex[address];
  if (gi == null) return;
  const marker = groupMarkers[gi];
  if (!markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
  if (!map.hasLayer(markerLayer)) map.addLayer(markerLayer);
  map.setView(marker.getLatLng(), 17);
  marker.openPopup();
};

// --- Jitter overlapping markers ---
// Addresses sharing a postcode have identical coords; offset them so all are visible
const coordCounts = {};
groups.forEach((g) => {
  const key = `${g.lat},${g.lng}`;
  coordCounts[key] = (coordCounts[key] || 0) + 1;
});

function jitter(lat, lng, index, total) {
  if (total <= 1) return [lat, lng];
  const angle = (2 * Math.PI * index) / total;
  const radius = 0.0002 + 0.00005 * Math.floor(index / 8); // ~20m, expand in rings
  return [lat + radius * Math.sin(angle), lng + radius * Math.cos(angle)];
}

// Index listingsData by address for delta view colouring
const listingsByAddress = {};
if (typeof listingsData !== "undefined") {
  listingsData.forEach((l) => { listingsByAddress[l.address] = l; });
}

const coordIndex = {};

// --- Marker layer ---
const markerLayer = L.layerGroup();
const groupMarkers = []; // groupMarkers[i] corresponds to groups[i]

groups.forEach((group, i) => {
  const key = `${group.lat},${group.lng}`;
  const idx = (coordIndex[key] = coordIndex[key] || 0);
  coordIndex[key]++;
  const [jLat, jLng] = jitter(group.lat, group.lng, idx, coordCounts[key]);

  const latest = getLatestPricedSale(group.sales);
  const band = latest.price != null ? getPriceBand(latest.price) : PRICE_BANDS[0];

  const marker = L.circleMarker([jLat, jLng], {
    radius: 6,
    fillColor: band.color,
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillOpacity: 0.85,
  });
  marker._origStyle = { fillColor: band.color, color: "#fff", weight: 2, radius: 6 };
  marker._group = group;

  // Build popup with sale history
  let popupHtml = `<div class="popup-address">${group.sales[0].address}</div>`;
  popupHtml += '<div class="popup-sales-list">';
  group.sales.forEach((s) => {
    const dateStr = s.date
      ? new Date(s.date).toLocaleDateString("en-GB", { year: "numeric", month: "short" })
      : "";
    const priceStr =
      s.price != null
        ? formatPrice(s.price)
        : `<span class="popup-no-price">${s.note || "No price"}</span>`;
    const jobLotBadge = s.jobLot ? '<span class="popup-job-lot">Job lot</span>' : "";
    popupHtml += `<div class="popup-sale-row">
      <span class="popup-sale-date">${dateStr}</span>
      <span class="popup-sale-price">${priceStr}${jobLotBadge}</span>
    </div>`;
  });
  popupHtml += "</div>";

  // Show linked job lot properties
  const jobLotSale = group.sales.find((s) => s._jobLotKey);
  if (jobLotSale) {
    const linked = [...datePricePostcodeBuckets.get(jobLotSale._jobLotKey)]
      .filter((addr) => addr !== group.sales[0].address)
      .sort();
    if (linked.length > 0) {
      popupHtml += `<div class="popup-job-lot-group">`;
      popupHtml += `<div class="popup-job-lot-header">Job lot with ${linked.length} other propert${linked.length === 1 ? "y" : "ies"}</div>`;
      popupHtml += linked.map((addr) =>
        `<a class="popup-job-lot-link" href="#" onclick="event.preventDefault();goToJobLotAddress('${addr.replace(/'/g, "\\'")}')">${addr}</a>`
      ).join("");
      popupHtml += `</div>`;
    }
  }

  marker.bindPopup(popupHtml, { maxWidth: 280, minWidth: 200 });

  markerLayer.addLayer(marker);
  groupMarkers[i] = marker;
});

markerLayer.addTo(map);

// --- Heatmap layer ---
const maxPrice = properties.reduce((max, p) => Math.max(max, p.price || 0), 0);
const heatData = groups.map((g) => {
  const latest = getLatestPricedSale(g.sales);
  return [g.lat, g.lng, (latest.price || 0) / maxPrice];
});

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

// Toggle control hidden for now — heatmap less useful, reduces clutter
// new ToggleControl().addTo(map);

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

  const notableSet = activeNotableFilter !== "all" ? notableFilterSets.get(activeNotableFilter) : null;
  const filteredHeatData = [];
  let visibleCount = 0;

  groups.forEach((group, i) => {
    // Check notable filter first
    if (notableSet && !notableSet.has(i)) {
      if (markerLayer.hasLayer(groupMarkers[i])) markerLayer.removeLayer(groupMarkers[i]);
      return;
    }

    const salesInRange = group.sales.filter((s) => {
      const year = getPropertyYear(s);
      return year !== null && year >= lo && year <= hi;
    });
    const marker = groupMarkers[i];

    if (salesInRange.length > 0) {
      if (!markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
      const latest = salesInRange.find((s) => s.price != null) || salesInRange[0];
      filteredHeatData.push([group.lat, group.lng, (latest.price || 0) / maxPrice]);
      visibleCount += salesInRange.length;
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

// Filtered stats: minimum 50 sales for price-based reports to be meaningful
const MIN_YEAR_SALES = 50;
const yearStatsReliable = yearStats.filter((s) => s.count >= MIN_YEAR_SALES);
// Exclude current partial year from YoY comparisons
const yearStatsComplete = yearStatsReliable.filter((s) => s.year !== currentYear);

// --- Info button + overlay ---
const InfoControl = L.Control.extend({
  options: { position: "topright" },

  onAdd() {
    const container = L.DomUtil.create("div", "info-button-control");
    container.innerHTML = '<button class="info-btn" aria-label="About this map"><span class="info-btn-icon">i</span> About</button>';
    L.DomEvent.disableClickPropagation(container);
    container.querySelector(".info-btn").addEventListener("click", () => {
      document.getElementById("info-overlay").classList.add("open");
    });
    return container;
  },
});

new InfoControl().addTo(map);

// --- Asking vs Sold delta view toggle ---
let deltaViewActive = false;

function toggleDeltaView() {
  deltaViewActive = !deltaViewActive;
  const btn = document.querySelector(".delta-toggle-btn");
  if (btn) btn.classList.toggle("active", deltaViewActive);

  updateLegend();
  updateMobileLegend();

  groupMarkers.forEach((marker) => {
    const group = marker._group;
    if (deltaViewActive) {
      const listing = listingsByAddress[group.sales[0].address];
      if (listing) {
        const band = getDeltaBand(listing.deltaPercent);
        marker.setStyle({ fillColor: band.color, fillOpacity: 0.85 });
      } else {
        marker.setStyle({ fillColor: "#d1d5db", fillOpacity: 0.4 });
      }
    } else {
      marker.setStyle({ fillColor: marker._origStyle.fillColor, fillOpacity: 0.85 });
    }
  });
}

function updateLegend() {
  const legendEl = document.querySelector(".legend-control");
  if (!legendEl) return;
  const bands = deltaViewActive ? DELTA_BANDS : PRICE_BANDS;
  const title = deltaViewActive ? "Asking vs Sold" : "Price";
  legendEl.innerHTML = `<h3>${title}</h3>` + bands.map((band) => `
    <div class="legend-item">
      <div class="legend-color" style="background: ${band.color}"></div>
      ${band.label}
    </div>
  `).join("");
}

function updateMobileLegend() {
  const sheetLegendItems = document.querySelector(".sheet-legend-items");
  if (!sheetLegendItems) return;
  const bands = deltaViewActive ? DELTA_BANDS : PRICE_BANDS;
  sheetLegendItems.innerHTML = bands.map((band) =>
    `<div class="sheet-legend-item"><span class="sheet-legend-color" style="background:${band.color}"></span>${band.label}</div>`
  ).join("");
}

const DeltaToggleControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const container = L.DomUtil.create("div", "delta-toggle-control");
    container.innerHTML = '<button class="delta-toggle-btn" aria-label="Toggle asking vs sold price view">Asking vs Sold</button>';
    L.DomEvent.disableClickPropagation(container);
    container.querySelector(".delta-toggle-btn").addEventListener("click", toggleDeltaView);
    return container;
  },
});

if (typeof listingsData !== "undefined" && listingsData.length > 0) {
  new DeltaToggleControl().addTo(map);
}

// Build overlay DOM
const infoOverlay = document.createElement("div");
infoOverlay.id = "info-overlay";
infoOverlay.innerHTML = `
  <div class="info-overlay-inner">
    <div class="info-header">
      <div class="info-tabs">
        <button class="info-tab active" data-tab="about">About</button>
        <button class="info-tab" data-tab="reports">Reports</button>
      </div>
      <button class="info-close-btn" aria-label="Close">&times;</button>
    </div>

    <div class="info-tab-content active" id="tab-about">
      <p class="info-description">
        This map shows residential property sales in Shetland, sourced from
        HM Land Registry Price Paid data. It covers transactions from 2002 to
        the present. Each marker represents a sold property, coloured by sale
        price. Use the year filter and search to explore the data.
        Built by James Stewart (james@jastewart.co.uk).
      </p>

      <h3 class="faq-heading">FAQ</h3>

      <div class="faq-item">
        <div class="faq-question">Why are the markers not over specific homes?</div>
        <div class="faq-answer">Markers are positioned at a postcode-level point, not at individual properties. If multiple homes share the same postcode, they get arranged in a peerie circle around that point rather than sitting on the actual buildings.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">Why isn't my home listed?</div>
        <div class="faq-answer">The data comes from Scotland's Land Information Service (ScotLIS), which records sold properties. Some homes are missing from their records. Others are passed between family members without a sale price, so they don't appear. Self-builds that have never been sold to a buyer won't be listed either. In rare cases, ScotLIS even has the postcode wrong for a property.</div>
      </div>

      <div class="faq-item">
        <div class="faq-question">When was the data last pulled?</div>
        <div class="faq-answer">February 2026.</div>
      </div>
    </div>

    <div class="info-tab-content" id="tab-reports">
      <div class="report-summary-cards" id="report-summary-cards"></div>

      ${typeof listingsData !== "undefined" && listingsData.length > 0 ? `
      <div class="report-collapse">
        <button class="report-collapse-header"><span>Asking vs Sold Price</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <p class="report-description">How much do Shetland properties sell for relative to their asking price? Based on ${listingsData.length} matched sales from agent listings (mostly "Offers Over").</p>
          <div id="asking-vs-sold-summary" class="report-summary-cards"></div>
          <div class="chart-container"><canvas id="chart-asking-vs-sold"></canvas></div>
          <table class="info-table" id="asking-vs-sold-table">
            <thead><tr><th>Address</th><th>Asked</th><th>Sold</th><th>Delta</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      ` : ""}

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Average Sale Price by Year</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-price-trend"></canvas></div>
          <table class="info-table">
            <thead><tr><th>Year</th><th>Avg Price</th><th>Sales</th></tr></thead>
            <tbody>
              ${yearStatsReliable.map((s) => `<tr><td>${s.year}${s.year === currentYear ? " *" : ""}</td><td class="price-cell">${formatPrice(s.avg)}</td><td>${s.count}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Year-on-Year Price Change</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-yoy"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Number of Sales per Year</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-volume"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Total Market Value by Year</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-market-value"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Sales by Month</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-monthly"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Sales by Price Band</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-distribution"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Average Price by Area</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <div class="chart-container"><canvas id="chart-area"></canvas></div>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Top 10 Most Expensive Sales</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <table class="info-table" id="top-sales-table">
            <thead><tr><th>Address</th><th>Price</th><th>Date</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="report-collapse">
        <button class="report-collapse-header"><span>Job Lot Sales</span><span class="report-collapse-chevron">&#9654;</span></button>
        <div class="report-collapse-body">
          <p class="report-description">Bulk purchases where multiple properties at the same postcode sold for the same price on the same date.</p>
          <div id="job-lot-summary-cards" class="report-summary-cards"></div>
          <div id="job-lot-accordion"></div>
        </div>
      </div>
    </div>
  </div>
`;
document.body.appendChild(infoOverlay);

infoOverlay.querySelector(".info-close-btn").addEventListener("click", () => {
  infoOverlay.classList.remove("open");
});

// --- Collapsible report sections ---
infoOverlay.querySelectorAll(".report-collapse-header").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".report-collapse").classList.toggle("open");
  });
});

// --- Tab switching ---
const infoTabs = infoOverlay.querySelectorAll(".info-tab");
const infoTabContents = infoOverlay.querySelectorAll(".info-tab-content");

infoTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    infoTabs.forEach((t) => t.classList.remove("active"));
    infoTabContents.forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");

    if (tab.dataset.tab === "reports" && !chartsInitialized) {
      initCharts();
      chartsInitialized = true;
    }
  });
});

// --- Charts ---
let chartsInitialized = false;

function computePriceDistribution() {
  const counts = PRICE_BANDS.map(() => 0);
  reportSales.forEach((p) => {
    const idx = PRICE_BANDS.findIndex((band) => p.price <= band.max);
    if (idx !== -1) counts[idx]++;
  });
  return counts;
}

function computeAreaStats() {
  const areas = {};
  reportSales.forEach((p) => {
    const area = getArea(p.address);
    if (!areas[area]) areas[area] = [];
    areas[area].push(p.price);
  });

  return Object.entries(areas)
    .map(([name, prices]) => {
      prices.sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      return { name, avg, median, count: prices.length };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function computeMonthlyStats() {
  const months = Array.from({ length: 12 }, () => 0);
  properties.forEach((p) => {
    if (p.date) {
      const m = new Date(p.date).getMonth();
      months[m]++;
    }
  });
  return months;
}

function computeYoYChange() {
  const changes = [];
  for (let i = 1; i < yearStatsComplete.length; i++) {
    const pct = ((yearStatsComplete[i].avg - yearStatsComplete[i - 1].avg) / yearStatsComplete[i - 1].avg) * 100;
    changes.push({ year: yearStatsComplete[i].year, pct: Math.round(pct * 10) / 10 });
  }
  return changes;
}

function computeMarketValue() {
  return yearStatsReliable.map((s) => ({
    year: s.year,
    total: s.avg * s.count,
  }));
}

function buildSummaryCards() {
  const totalSales = properties.length;
  const totalValue = reportSales.reduce((sum, p) => sum + p.price, 0);
  const allPrices = reportSales.map((p) => p.price).sort((a, b) => a - b);
  const median = allPrices[Math.floor(allPrices.length / 2)];
  const latest = yearStatsComplete[yearStatsComplete.length - 1];
  const first = yearStatsComplete[0];
  const overallChange = ((latest.avg - first.avg) / first.avg * 100).toFixed(0);

  const jobLotCount = properties.filter((p) => p.jobLot).length;

  const cards = [
    { label: "Total Sales", value: totalSales.toLocaleString("en-GB") },
    { label: "Total Value", value: "£" + (totalValue / 1e6).toFixed(1) + "m" },
    { label: "Median Price", value: formatPrice(median) },
    { label: "Price Change", value: (overallChange > 0 ? "+" : "") + overallChange + "%", sub: `${first.year}–${latest.year}` },
    { label: "Job Lot Sales", value: jobLotCount, sub: "same postcode, price & date" },
  ];

  document.getElementById("report-summary-cards").innerHTML = cards.map((c) =>
    `<div class="summary-card"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div>${c.sub ? `<div class="summary-sub">${c.sub}</div>` : ""}</div>`
  ).join("");
}

function buildTopSalesTable() {
  const top = [...reportSales].sort((a, b) => b.price - a.price).slice(0, 10);
  const tbody = document.querySelector("#top-sales-table tbody");
  tbody.innerHTML = top.map((p) => {
    const dateStr = p.date ? new Date(p.date).toLocaleDateString("en-GB", { year: "numeric", month: "short" }) : "";
    return `<tr><td>${p.address}</td><td class="price-cell">${formatPrice(p.price)}</td><td>${dateStr}</td></tr>`;
  }).join("");
}

function buildJobLotReport() {
  // Build job lot groups from the detection buckets
  const jobLots = [];
  datePricePostcodeBuckets.forEach((addresses, key) => {
    if (addresses.size < 2) return;
    const [date, price] = key.split("|");
    // Extract common area from first address
    const firstAddr = [...addresses][0];
    const parts = firstAddr.split(",").map((s) => s.trim());
    // Use street/estate name (everything before the town)
    const location = parts.length >= 3 ? parts.slice(-3, -1).join(", ") : parts.slice(1).join(", ");
    jobLots.push({
      location,
      count: addresses.size,
      price: parseInt(price),
      date,
      addresses: [...addresses].sort(),
    });
  });

  // Sort by lot price descending
  jobLots.sort((a, b) => b.price - a.price);

  // Summary cards
  const totalLots = jobLots.length;
  const totalProperties = jobLots.reduce((sum, l) => sum + l.count, 0);
  const totalValue = jobLots.reduce((sum, l) => sum + l.price, 0);
  const largest = jobLots.reduce((max, l) => l.count > max.count ? l : max, jobLots[0]);

  document.getElementById("job-lot-summary-cards").innerHTML = [
    { label: "Job Lots", value: totalLots },
    { label: "Properties", value: totalProperties },
    { label: "Combined Value", value: "£" + (totalValue / 1e6).toFixed(1) + "m" },
    { label: "Largest Lot", value: largest.count + " properties", sub: largest.location },
  ].map((c) =>
    `<div class="summary-card"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div>${c.sub ? `<div class="summary-sub">${c.sub}</div>` : ""}</div>`
  ).join("");

  // Accordion panels
  const container = document.getElementById("job-lot-accordion");
  container.innerHTML = jobLots.map((l, i) => {
    const dateStr = new Date(l.date).toLocaleDateString("en-GB", { year: "numeric", month: "short" });
    const shortPrice = formatShortPrice(l.price);
    const perProperty = formatShortPrice(Math.round(l.price / l.count));
    const addressList = l.addresses.map((addr) =>
      `<a class="jl-address-link" href="#" onclick="event.preventDefault();goToJobLotAddress('${addr.replace(/'/g, "\\'")}')">${addr}</a>`
    ).join("");
    return `<div class="jl-panel">
      <button class="jl-panel-header" data-index="${i}">
        <div class="jl-panel-title">
          <span class="jl-panel-location">${l.location}</span>
          <span class="jl-panel-meta">${l.count} properties &middot; ${dateStr}</span>
        </div>
        <span class="jl-panel-price-badge">${shortPrice}</span>
        <span class="jl-panel-chevron">&#9654;</span>
      </button>
      <div class="jl-panel-body">
        <div class="jl-panel-stats">
          <span>Lot price: <strong>${formatPrice(l.price)}</strong></span>
          <span>Per property: <strong>${perProperty}</strong></span>
        </div>
        <div class="jl-panel-addresses">${addressList}</div>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll(".jl-panel-header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.closest(".jl-panel");
      panel.classList.toggle("open");
    });
  });
}

function buildAskingVsSold() {
  const sorted = [...listingsData].sort((a, b) => b.askingPrice - a.askingPrice);
  const deltas = sorted.filter((m) => m.deltaPercent !== null);

  // Summary cards
  const overAsking = deltas.filter((m) => m.delta > 0).length;
  const underAsking = deltas.filter((m) => m.delta < 0).length;
  const atAsking = deltas.filter((m) => m.delta === 0).length;
  const overDeltaList = deltas.filter((m) => m.delta > 0);
  const avgOverPct = overDeltaList.length > 0
    ? overDeltaList.reduce((s, m) => s + m.deltaPercent, 0) / overDeltaList.length
    : 0;
  const offersOver = deltas.filter((m) => m.askingType === "offers_over");
  const ooMedian = offersOver.length > 0
    ? offersOver.map((m) => m.deltaPercent).sort((a, b) => a - b)[Math.floor(offersOver.length / 2)]
    : null;

  document.getElementById("asking-vs-sold-summary").innerHTML = [
    { label: "Sold Over Asking", value: Math.round((overAsking / deltas.length) * 100) + "%", sub: overAsking + " of " + deltas.length },
    { label: "Avg Over Asking", value: "+" + avgOverPct.toFixed(1) + "%", sub: overDeltaList.length + " sales above asking" },
    { label: "Offers Over Median", value: ooMedian !== null ? ((ooMedian > 0 ? "+" : "") + ooMedian.toFixed(1) + "%") : "—", sub: offersOver.length + " O/O sales" },
    { label: "At or Under Asking", value: atAsking + underAsking, sub: Math.round(((atAsking + underAsking) / deltas.length) * 100) + "% of sales" },
  ].map((c) =>
    `<div class="summary-card"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div>${c.sub ? `<div class="summary-sub">${c.sub}</div>` : ""}</div>`
  ).join("");

  // Set chart height proportional to number of properties (25px per bar)
  const chartContainer = document.getElementById("chart-asking-vs-sold").parentElement;
  chartContainer.style.height = Math.max(400, sorted.length * 25) + "px";

  // Chart: horizontal bar — % over/under asking per property
  new Chart(document.getElementById("chart-asking-vs-sold"), {
    type: "bar",
    data: {
      labels: sorted.map((m) => {
        const parts = m.address.split(",");
        return parts[0].length > 25 ? parts[0].substring(0, 22) + "..." : parts[0];
      }),
      datasets: [{
        label: "% Over/Under Asking",
        data: sorted.map((m) => m.deltaPercent),
        backgroundColor: sorted.map((m) =>
          m.delta > 0 ? "rgba(34, 197, 94, 0.7)" : m.delta < 0 ? "rgba(239, 68, 68, 0.7)" : "rgba(148, 163, 184, 0.7)"
        ),
        borderColor: sorted.map((m) =>
          m.delta > 0 ? "#16a34a" : m.delta < 0 ? "#dc2626" : "#94a3b8"
        ),
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => sorted[items[0].dataIndex].address,
            label: (ctx) => {
              const m = sorted[ctx.dataIndex];
              return [
                "Asked: " + formatPrice(m.askingPrice) + " (" + (m.askingType === "offers_over" ? "O/O" : m.askingType) + ")",
                "Sold: " + formatPrice(m.soldPrice) + " on " + m.soldDate,
                "Delta: " + (m.delta > 0 ? "+" : "") + formatPrice(m.delta) + " (" + (m.deltaPercent > 0 ? "+" : "") + m.deltaPercent + "%)",
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { callback: (v) => (v > 0 ? "+" : "") + v + "%" },
          grid: { color: (ctx) => ctx.tick.value === 0 ? "#333" : "#e5e7eb" },
        },
        y: {
          ticks: { font: { size: 10 } },
        },
      },
    },
  });

  // Table
  const tbody = document.querySelector("#asking-vs-sold-table tbody");
  tbody.innerHTML = sorted.map((m) => {
    const deltaColor = m.delta > 0 ? "color:#16a34a" : m.delta < 0 ? "color:#dc2626" : "";
    const deltaStr = (m.delta > 0 ? "+" : "") + formatPrice(m.delta) + " (" + (m.deltaPercent > 0 ? "+" : "") + m.deltaPercent + "%)";
    return `<tr>
      <td>${m.address}</td>
      <td class="price-cell">${formatPrice(m.askingPrice)}</td>
      <td class="price-cell">${formatPrice(m.soldPrice)}</td>
      <td class="price-cell" style="${deltaColor}">${deltaStr}</td>
    </tr>`;
  }).join("");
}

function initCharts() {
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.color = "#555";

  buildSummaryCards();
  buildTopSalesTable();
  buildJobLotReport();
  if (typeof listingsData !== "undefined" && listingsData.length > 0) {
    buildAskingVsSold();
  }

  // 1. Price trend line chart (reliable years only)
  new Chart(document.getElementById("chart-price-trend"), {
    type: "line",
    data: {
      labels: yearStatsReliable.map((s) => s.year),
      datasets: [{
        label: "Average Sale Price",
        data: yearStatsReliable.map((s) => s.avg),
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#2563eb",
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => formatPrice(ctx.parsed.y) } },
      },
      scales: {
        y: {
          ticks: { callback: (v) => "\u00A3" + (v / 1000) + "k" },
          beginAtZero: true,
        },
      },
    },
  });

  // 2. Volume bar chart
  new Chart(document.getElementById("chart-volume"), {
    type: "bar",
    data: {
      labels: yearStats.map((s) => s.year),
      datasets: [{
        label: "Number of Sales",
        data: yearStats.map((s) => s.count),
        backgroundColor: "rgba(37, 99, 235, 0.6)",
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // 3. Price distribution doughnut
  const distCounts = computePriceDistribution();
  new Chart(document.getElementById("chart-distribution"), {
    type: "doughnut",
    data: {
      labels: PRICE_BANDS.map((b) => b.label),
      datasets: [{
        data: distCounts,
        backgroundColor: PRICE_BANDS.map((b) => b.color),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = distCounts.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return `${ctx.label}: ${ctx.parsed} sales (${pct}%)`;
            },
          },
        },
      },
    },
  });

  // 4. Area breakdown horizontal bar
  const areaStats = computeAreaStats();
  new Chart(document.getElementById("chart-area"), {
    type: "bar",
    data: {
      labels: areaStats.map((a) => a.name),
      datasets: [{
        label: "Average Price",
        data: areaStats.map((a) => a.avg),
        backgroundColor: "rgba(37, 99, 235, 0.6)",
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { callback: (v) => "\u00A3" + (v / 1000) + "k" },
          beginAtZero: true,
        },
      },
    },
  });

  // 5. Year-on-year price change
  const yoyData = computeYoYChange();
  new Chart(document.getElementById("chart-yoy"), {
    type: "bar",
    data: {
      labels: yoyData.map((d) => d.year),
      datasets: [{
        label: "Year-on-Year Change",
        data: yoyData.map((d) => d.pct),
        backgroundColor: yoyData.map((d) => d.pct >= 0 ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)"),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y > 0 ? "+" : "") + ctx.parsed.y + "%" } },
      },
      scales: {
        y: {
          ticks: { callback: (v) => (v > 0 ? "+" : "") + v + "%" },
        },
      },
    },
  });

  // 6. Total market value
  const marketData = computeMarketValue();
  new Chart(document.getElementById("chart-market-value"), {
    type: "line",
    data: {
      labels: marketData.map((d) => d.year),
      datasets: [{
        label: "Total Market Value",
        data: marketData.map((d) => d.total),
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139, 92, 246, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#8b5cf6",
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => "\u00A3" + (ctx.parsed.y / 1e6).toFixed(1) + "m" } },
      },
      scales: {
        y: {
          ticks: { callback: (v) => "\u00A3" + (v / 1e6).toFixed(0) + "m" },
          beginAtZero: true,
        },
      },
    },
  });

  // 7. Sales by month
  const monthlyData = computeMonthlyStats();
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  new Chart(document.getElementById("chart-monthly"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{
        label: "Sales",
        data: monthlyData,
        backgroundColor: "rgba(37, 99, 235, 0.6)",
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

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
    const filterOptions = NOTABLE_FILTERS.map(f => {
      const count = f.key === "all" ? groups.length : notableFilterSets.get(f.key).size;
      return `<option value="${f.key}">${f.label} (${count})</option>`;
    }).join("");
    container.innerHTML = `
      <input type="text" id="search-input" placeholder="Search address or postcode..." />
      <select id="notable-filter">${filterOptions}</select>
      <div id="search-results"></div>
    `;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  },
});

new SearchControl().addTo(map);

// --- Notable filter handler ---
document.getElementById("notable-filter").addEventListener("change", (e) => {
  activeNotableFilter = e.target.value;
  applyYearFilter();
});

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

function goToResult(groupIndex) {
  clearHighlights();
  const marker = groupMarkers[groupIndex];
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
  groups.forEach((group, i) => {
    if (normalize(group.sales[0].address).includes(query)) {
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
    const group = groups[i];
    const latest = getLatestPricedSale(group.sales);
    const priceStr = latest.price != null ? formatPrice(latest.price) : "No price";
    const salesCount = group.sales.length;
    return `<div class="search-item" data-index="${i}">
      <span class="search-item-address">${group.sales[0].address}</span>
      <span class="search-item-meta">${priceStr}${salesCount > 1 ? " &middot; " + salesCount + " sales" : ""}</span>
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

// --- Area summary card on zoom ---
const AreaSummaryControl = L.Control.extend({
  options: { position: "bottomright" },

  onAdd() {
    const container = L.DomUtil.create("div", "area-summary-control");
    container.style.display = "none";
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  },
});

const areaSummaryControl = new AreaSummaryControl();
areaSummaryControl.addTo(map);
const areaSummaryEl = areaSummaryControl.getContainer();

let areaSummaryTimeout;
function updateAreaSummary() {
  clearTimeout(areaSummaryTimeout);
  areaSummaryTimeout = setTimeout(() => {
    if (map.getZoom() < 13) {
      areaSummaryEl.style.display = "none";
      return;
    }

    const bounds = map.getBounds();
    const areaCounts = {};
    const areaGroups = {};

    groups.forEach((g) => {
      if (!bounds.contains([g.lat, g.lng])) return;
      const area = g.area;
      areaCounts[area] = (areaCounts[area] || 0) + 1;
      if (!areaGroups[area]) areaGroups[area] = [];
      areaGroups[area].push(g);
    });

    const areas = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
    if (areas.length === 0) {
      areaSummaryEl.style.display = "none";
      return;
    }

    // Use dominant area if it has clear majority, otherwise show "Mixed Areas"
    const [topArea, topCount] = areas[0];
    const totalVisible = areas.reduce((s, a) => s + a[1], 0);
    const dominantArea = topCount / totalVisible >= 0.5 ? topArea : null;

    if (!dominantArea) {
      areaSummaryEl.style.display = "none";
      return;
    }

    // Compute stats from visible groups in the dominant area
    const visibleGroups = areaGroups[dominantArea];
    const prices = [];
    let saleCount = 0;

    visibleGroups.forEach((g) => {
      const sale = g.sales.find((s) => s.price != null && !s.jobLot);
      if (sale) {
        prices.push(sale.price);
        saleCount++;
      }
    });

    if (prices.length === 0) {
      areaSummaryEl.style.display = "none";
      return;
    }

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const min = prices[0];
    const max = prices[prices.length - 1];

    areaSummaryEl.innerHTML = `
      <div class="area-summary-name">${dominantArea}</div>
      <div class="area-summary-subtitle">Visible area</div>
      <div class="area-summary-stats">
        <div class="area-summary-row"><span class="area-summary-key">Properties</span><span class="area-summary-val">${saleCount}</span></div>
        <div class="area-summary-row"><span class="area-summary-key">Avg price</span><span class="area-summary-val">${formatShortPrice(avg)}</span></div>
        <div class="area-summary-row"><span class="area-summary-key">Median</span><span class="area-summary-val">${formatShortPrice(median)}</span></div>
        <div class="area-summary-row"><span class="area-summary-key">Range</span><span class="area-summary-val">${formatShortPrice(min)} – ${formatShortPrice(max)}</span></div>
      </div>
    `;
    areaSummaryEl.style.display = "block";
  }, 200);
}

map.on("moveend", updateAreaSummary);
map.on("zoomend", updateAreaSummary);

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
