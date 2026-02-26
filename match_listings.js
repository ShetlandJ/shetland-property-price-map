#!/usr/bin/env node

/**
 * Listing Matcher — matches agent asking prices against ScotLIS sold prices.
 *
 * Reads scraped listing data from cache/ and matches against data.js sale records.
 *
 * Usage:
 *   node match_listings.js            # Run matching
 *   node match_listings.js --export   # Export to listings_data.js
 *   node match_listings.js --stats    # Summary stats
 */

const fs = require("fs");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "cache");
const KELVIN_SOLD = path.join(CACHE_DIR, "kelvin_sold.json");
const KELVIN_ACTIVE = path.join(CACHE_DIR, "kelvin_active.json");
const ARTHUR_ACTIVE = path.join(CACHE_DIR, "arthur_active.json");
const TAIT_ALL = path.join(CACHE_DIR, "tait_all.json");
const MATCHED_FILE = path.join(CACHE_DIR, "matched_prices.json");
const DATA_JS = path.join(__dirname, "data.js");
const OUTPUT_FILE = path.join(__dirname, "listings_data.js");

// --- Load data sources ---

function loadListings() {
  const all = [];

  if (fs.existsSync(KELVIN_SOLD)) {
    const data = JSON.parse(fs.readFileSync(KELVIN_SOLD, "utf8"));
    all.push(...data);
    console.log(`  Kelvin sold: ${data.length} listings`);
  }

  if (fs.existsSync(KELVIN_ACTIVE)) {
    const data = JSON.parse(fs.readFileSync(KELVIN_ACTIVE, "utf8"));
    all.push(...data);
    console.log(`  Kelvin active: ${data.length} listings`);
  }

  if (fs.existsSync(ARTHUR_ACTIVE)) {
    const data = JSON.parse(fs.readFileSync(ARTHUR_ACTIVE, "utf8"));
    all.push(...data);
    console.log(`  Arthur active: ${data.length} listings`);
  }

  if (fs.existsSync(TAIT_ALL)) {
    const data = JSON.parse(fs.readFileSync(TAIT_ALL, "utf8"));
    all.push(...data);
    console.log(`  Tait & Peterson: ${data.length} listings`);
  }

  return all;
}

function loadScotlisData() {
  if (!fs.existsSync(DATA_JS)) {
    throw new Error("data.js not found — run fetch_data.js --export first");
  }

  const content = fs.readFileSync(DATA_JS, "utf8");
  // data.js defines: const properties = [...];
  // We eval it in a sandbox to extract the array
  const sandbox = {};
  const fn = new Function(content + "\nreturn properties;");
  const properties = fn();

  console.log(`  ScotLIS data.js: ${properties.length} sale records`);
  return properties;
}

// --- Address normalization ---

function normalizeAddress(addr) {
  return addr
    .toUpperCase()
    .replace(/,?\s*SHETLAND\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/,\s*$/, "")
    .trim();
}

function extractStreetPart(addr) {
  // Get the part before the first comma (house number + street name)
  const normalized = normalizeAddress(addr);
  const firstComma = normalized.indexOf(",");
  return firstComma > 0 ? normalized.substring(0, firstComma).trim() : normalized;
}

function extractAllAddressParts(addr) {
  const normalized = normalizeAddress(addr);
  const parts = normalized.split(",").map((p) => p.trim()).filter(Boolean);
  // Remove postcode only — keep everything else for matching
  return parts.filter((p) => !p.match(/^ZE\d/));
}

function extractPostcode(addr) {
  const match = addr.match(/\b(ZE[1-3]\s*\d[A-Z]{2})\b/i);
  if (!match) return null;
  return match[1].toUpperCase().replace(/\s+/, " ");
}

// --- Matching ---

function buildScotlisIndex(properties) {
  // Index by postcode for fast lookup
  const byPostcode = new Map();

  for (const prop of properties) {
    const postcode = extractPostcode(prop.address);
    if (!postcode) continue;

    if (!byPostcode.has(postcode)) byPostcode.set(postcode, []);
    byPostcode.get(postcode).push(prop);
  }

  return byPostcode;
}

function findBestMatch(listing, scotlisIndex) {
  const postcode = listing.postcode;
  if (!postcode) return null;

  const candidates = scotlisIndex.get(postcode);
  if (!candidates || candidates.length === 0) return null;

  const listingStreet = extractStreetPart(listing.address);
  const listingParts = extractAllAddressParts(listing.address);

  // Build a set of all FIRST parts across all ScotLIS candidates at this postcode.
  // If a word appears as a first part, it's a house/property name.
  // If it only appears as a later part, it's a locality/street.
  const candidateFirstParts = new Set();
  const allCandidateParts = [];
  for (const c of candidates) {
    const cp = extractAllAddressParts(c.address);
    allCandidateParts.push(cp);
    if (cp[0]) candidateFirstParts.add(cp[0]);
  }

  // Determine if listing's first part is a house name or a locality/street
  // It's a house name if it appears as the first part of a ScotLIS address
  // It's a locality if it appears only as a later part, or if ScotLIS has
  // numbered addresses on this name (e.g., "1 MURRAYSTON", "2 MURRAYSTON")
  const listingFirst = listingParts[0] || "";

  // Reject bare road/street names without a house number (e.g. "HILLSIDE ROAD")
  const ROAD_WORDS = /\b(ROAD|STREET|LANE|DRIVE|CRESCENT|PLACE|CLOSE|WAY|WYND|TERRACE|COURT|AVENUE|GARDENS|HILL|SQUARE)\b/i;
  if (ROAD_WORDS.test(listingFirst) && !/\d/.test(listingFirst)) return null;

  const isHouseName = candidateFirstParts.has(listingFirst);
  const isNumberedStreet = candidateFirstParts.has(listingFirst)
    ? false
    : [...candidateFirstParts].some((fp) => fp.match(new RegExp("^\\d+[A-Z]?\\s+" + listingFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$")));

  // If the listing's first part is a numbered street name (e.g., "MURRAYSTON" where
  // ScotLIS has "1 MURRAYSTON", "2 MURRAYSTON"), we can't match without a house number
  if (!isHouseName && isNumberedStreet) return null;

  // If the listing's first part doesn't appear as any first part in ScotLIS,
  // and doesn't appear at all, it's genuinely unknown
  if (!isHouseName && !isNumberedStreet) {
    // Check if it appears anywhere in candidate addresses
    const appearsAnywhere = candidates.some((c) =>
      c.address.toUpperCase().includes(listingFirst)
    );
    if (!appearsAnywhere) return null;
    // It appears as a middle part only — it's a locality, can't match uniquely
    return null;
  }

  // Score each candidate
  let bestMatch = null;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.price === null) continue;

    const candidateStreet = extractStreetPart(candidate.address);
    const candidateParts = allCandidateParts[i];
    let score = 0;

    // Exact first-part match
    if (candidateStreet === listingStreet) {
      score = 100;
    } else if (candidateParts[0] === listingFirst) {
      // House name matches — check how many other parts also match
      const candidatePartsSet = new Set(candidateParts);
      const commonParts = listingParts.filter((p) => candidatePartsSet.has(p));
      if (commonParts.length === listingParts.length) {
        score = 98;
      } else if (commonParts.length >= 1) {
        score = 95;
      }
    } else {
      // Try house number matching
      const listingNum = listingStreet.match(/^(\d+[A-Z]?)\s/);
      const candidateNum = candidateStreet.match(/^(\d+[A-Z]?)\s/);

      if (listingNum && candidateNum && listingNum[1] === candidateNum[1]) {
        const listingWords = listingStreet.replace(/^\d+[A-Z]?\s+/, "").split(/\s+/);
        const candidateWords = candidateStreet.replace(/^\d+[A-Z]?\s+/, "").split(/\s+/);
        const commonWords = listingWords.filter((w) => candidateWords.includes(w));
        score = 50 + (commonWords.length / Math.max(listingWords.length, candidateWords.length)) * 40;
      }

      // Check if any listing part matches candidate's first part
      // e.g., listing ["HELENLEA", "27 HILLHEAD"] where "HELENLEA" = candidate first "HELENLEA"
      if (score < 80 && listingParts.length > 1) {
        for (const lp of listingParts) {
          if (lp === candidateParts[0]) {
            score = Math.max(score, 90);
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { candidate, score };
    }
  }

  if (bestMatch && bestMatch.score >= 70) {
    return bestMatch;
  }

  return null;
}

function runMatching() {
  console.log("Loading data sources...");
  const listings = loadListings();
  const scotlisProperties = loadScotlisData();

  if (listings.length === 0) {
    console.log("\nNo listings found. Run fetch_kelvin.js and/or fetch_arthur.js first.");
    return [];
  }

  console.log(`\nBuilding ScotLIS index...`);
  const scotlisIndex = buildScotlisIndex(scotlisProperties);
  console.log(`  Indexed ${scotlisIndex.size} postcodes`);

  console.log(`\nMatching ${listings.length} listings against ScotLIS data...\n`);

  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const listing of listings) {
    if (!listing.askingPrice) {
      unmatched.push({ listing, reason: "no asking price" });
      continue;
    }

    // Only match sold listings — active/under offer haven't completed sale yet
    if (listing.status === "for_sale" || listing.status === "under_offer") {
      unmatched.push({ listing, reason: "not yet sold" });
      continue;
    }

    const match = findBestMatch(listing, scotlisIndex);

    if (!match) {
      unmatched.push({ listing, reason: "no ScotLIS match found" });
      continue;
    }

    if (match.score < 80) {
      ambiguous.push({ listing, match });
    }

    // Find the most recent sale for this address
    const postcode = listing.postcode;
    const candidates = scotlisIndex.get(postcode) || [];
    const candidateStreet = extractStreetPart(match.candidate.address);

    // Get all sales for the matched address (same street part)
    // Filter out non-market transfers (typically £10,000 or less — "Love Favour and Affection" etc.)
    const MIN_MARKET_PRICE = 10000;
    const addressSales = candidates
      .filter(
        (c) =>
          extractStreetPart(c.address) === candidateStreet &&
          c.price !== null &&
          c.price >= MIN_MARKET_PRICE
      )
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const mostRecent = addressSales[0];
    if (!mostRecent) continue;

    const delta = mostRecent.price - listing.askingPrice;
    const deltaPercent =
      listing.askingPrice > 0
        ? parseFloat(((delta / listing.askingPrice) * 100).toFixed(2))
        : null;

    matched.push({
      address: mostRecent.address,
      postcode: listing.postcode,
      askingPrice: listing.askingPrice,
      askingType: listing.askingType,
      soldPrice: mostRecent.price,
      soldDate: mostRecent.date,
      delta,
      deltaPercent,
      agent: listing.agent,
      source: listing.source,
      matchScore: match.score,
      bedrooms: listing.bedrooms,
      propertyType: listing.propertyType,
      listingAddress: listing.address,
    });
  }

  // Deduplicate — same ScotLIS address from different sources, keep highest-score match
  const deduped = [];
  const seen = new Map();
  for (const m of matched) {
    const key = m.address + "|" + m.soldDate;
    const existing = seen.get(key);
    if (!existing || m.matchScore > existing.matchScore) {
      seen.set(key, m);
    }
  }
  const dedupedMatched = [...seen.values()];
  const dupeCount = matched.length - dedupedMatched.length;

  // Save results
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(MATCHED_FILE, JSON.stringify(dedupedMatched, null, 2));

  // Summary
  console.log(`Results:`);
  console.log(`  Matched: ${dedupedMatched.length}${dupeCount > 0 ? ` (${dupeCount} duplicates removed)` : ""}`);
  console.log(`  Unmatched: ${unmatched.length}`);
  if (ambiguous.length > 0) {
    console.log(`  Ambiguous (score < 80): ${ambiguous.length}`);
  }
  console.log(`\nSaved to ${path.basename(MATCHED_FILE)}`);

  // Show unmatched reasons
  const reasons = {};
  unmatched.forEach((u) => {
    reasons[u.reason] = (reasons[u.reason] || 0) + 1;
  });
  if (Object.keys(reasons).length > 0) {
    console.log(`\nUnmatched breakdown:`);
    Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
      });
  }

  // Show ambiguous matches for review
  if (ambiguous.length > 0) {
    console.log(`\nAmbiguous matches (manual review recommended):`);
    ambiguous.forEach(({ listing, match }) => {
      console.log(
        `  "${listing.address}" → "${match.candidate.address}" (score: ${match.score.toFixed(0)})`
      );
    });
  }

  return matched;
}

// --- Export ---

function exportToListingsData() {
  if (!fs.existsSync(MATCHED_FILE)) {
    console.log("No matched data. Run: node match_listings.js");
    return;
  }

  const matched = JSON.parse(fs.readFileSync(MATCHED_FILE, "utf8"));

  const lines = matched.map((m) => {
    return `  ${JSON.stringify({
      address: m.address,
      postcode: m.postcode,
      askingPrice: m.askingPrice,
      askingType: m.askingType,
      soldPrice: m.soldPrice,
      soldDate: m.soldDate,
      delta: m.delta,
      deltaPercent: m.deltaPercent,
      agent: m.agent,
      source: m.source,
    })}`;
  });

  const output =
    "const listingsData = [\n" + lines.join(",\n") + "\n];\n";
  fs.writeFileSync(OUTPUT_FILE, output);

  console.log(`Exported ${matched.length} matched records to ${path.basename(OUTPUT_FILE)}`);
}

// --- Stats ---

function showStats() {
  console.log("Listing match stats:\n");

  if (!fs.existsSync(MATCHED_FILE)) {
    console.log("No matched data yet. Run: node match_listings.js");
    return;
  }

  const matched = JSON.parse(fs.readFileSync(MATCHED_FILE, "utf8"));
  console.log(`Total matched: ${matched.length}`);

  // By source
  const bySrc = {};
  matched.forEach((m) => {
    bySrc[m.source] = (bySrc[m.source] || 0) + 1;
  });
  console.log(`\nBy source:`);
  Object.entries(bySrc).forEach(([src, count]) => {
    console.log(`  ${src}: ${count}`);
  });

  // Delta stats
  const deltas = matched.filter((m) => m.deltaPercent !== null);
  if (deltas.length > 0) {
    const avgDelta =
      deltas.reduce((sum, m) => sum + m.deltaPercent, 0) / deltas.length;
    const medianDelta = deltas
      .map((m) => m.deltaPercent)
      .sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
    const soldOver = deltas.filter((m) => m.delta > 0).length;
    const soldUnder = deltas.filter((m) => m.delta < 0).length;
    const soldAt = deltas.filter((m) => m.delta === 0).length;

    console.log(`\nAsking vs Sold price:`);
    console.log(`  Average delta: ${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(1)}%`);
    console.log(`  Median delta: ${medianDelta > 0 ? "+" : ""}${medianDelta.toFixed(1)}%`);
    console.log(`  Sold over asking: ${soldOver} (${((soldOver / deltas.length) * 100).toFixed(0)}%)`);
    console.log(`  Sold under asking: ${soldUnder} (${((soldUnder / deltas.length) * 100).toFixed(0)}%)`);
    console.log(`  Sold at asking: ${soldAt} (${((soldAt / deltas.length) * 100).toFixed(0)}%)`);

    // Top 5 biggest over-asking
    const topOver = [...deltas]
      .sort((a, b) => b.deltaPercent - a.deltaPercent)
      .slice(0, 5);
    console.log(`\nTop 5 sold over asking:`);
    topOver.forEach((m) => {
      console.log(
        `  +${m.deltaPercent.toFixed(1)}% — ${m.address} (asked £${m.askingPrice.toLocaleString()}, sold £${m.soldPrice.toLocaleString()})`
      );
    });

    // Top 5 biggest under-asking
    const topUnder = [...deltas]
      .sort((a, b) => a.deltaPercent - b.deltaPercent)
      .slice(0, 5);
    console.log(`\nTop 5 sold under asking:`);
    topUnder.forEach((m) => {
      console.log(
        `  ${m.deltaPercent.toFixed(1)}% — ${m.address} (asked £${m.askingPrice.toLocaleString()}, sold £${m.soldPrice.toLocaleString()})`
      );
    });
  }

  // By asking type
  const byType = {};
  matched.forEach((m) => {
    const type = m.askingType || "unknown";
    if (!byType[type]) byType[type] = { count: 0, totalDelta: 0 };
    byType[type].count++;
    if (m.deltaPercent !== null) byType[type].totalDelta += m.deltaPercent;
  });
  console.log(`\nBy asking type:`);
  Object.entries(byType).forEach(([type, data]) => {
    const avg = data.count > 0 ? data.totalDelta / data.count : 0;
    console.log(
      `  ${type}: ${data.count} properties, avg delta ${avg > 0 ? "+" : ""}${avg.toFixed(1)}%`
    );
  });
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    showStats();
    return;
  }

  if (args.includes("--export")) {
    exportToListingsData();
    return;
  }

  runMatching();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
