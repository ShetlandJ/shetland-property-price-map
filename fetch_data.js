#!/usr/bin/env node

/**
 * ScotLIS Property Data Fetcher for Shetland
 *
 * Fetches all property sales from ScotLIS for every valid ZE postcode.
 * Captures ALL titles per address (multiple sales over time).
 *
 * Usage:
 *   node fetch_data.js              # Start or resume fetching
 *   node fetch_data.js --export     # Export cached data to data.js (skip fetching)
 *   node fetch_data.js --stats      # Show progress stats
 *
 * Rate limiting: 18–23 second random delay between requests.
 * Progress is cached in cache/ so it can be resumed if interrupted.
 * Estimated runtime: ~5 hours for all Shetland postcodes.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "cache");
const PROGRESS_FILE = path.join(CACHE_DIR, "progress.json");
const POSTCODES_FILE = path.join(CACHE_DIR, "postcodes.json");
const OUTPUT_FILE = path.join(__dirname, "data.js");

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  // 18–23 seconds to avoid rate limiting
  return 18000 + Math.random() * 5000;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout for ${url}`));
    });
  });
}

// --- Postcode Discovery ---

async function fetchAllPostcodes() {
  if (fs.existsSync(POSTCODES_FILE)) {
    console.log("Loading cached postcodes...");
    return JSON.parse(fs.readFileSync(POSTCODES_FILE, "utf8"));
  }

  console.log("Fetching all valid ZE postcodes from postcodes.io...");
  const postcodes = {};
  const prefixes = ["ZE1", "ZE2", "ZE3"];

  for (const prefix of prefixes) {
    // Generate all possible postcode suffixes (0-9 + 0AA-9ZZ)
    for (let num = 0; num <= 9; num++) {
      for (let c1 = 65; c1 <= 90; c1++) {
        for (let c2 = 65; c2 <= 90; c2++) {
          const suffix = `${num}${String.fromCharCode(c1)}${String.fromCharCode(c2)}`;
          const pc = `${prefix} ${suffix}`;

          // Batch validate using postcodes.io (up to 100 at a time)
          // We'll collect and batch below
          postcodes[pc] = null; // placeholder
        }
      }
    }
  }

  // Batch validate postcodes (postcodes.io accepts 100 per request)
  const allCodes = Object.keys(postcodes);
  const validPostcodes = {};
  const batchSize = 100;

  for (let i = 0; i < allCodes.length; i += batchSize) {
    const batch = allCodes.slice(i, i + batchSize);
    const progress = Math.round((i / allCodes.length) * 100);
    process.stdout.write(`\rValidating postcodes... ${progress}% (${Object.keys(validPostcodes).length} valid)`);

    try {
      const result = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({ postcodes: batch });
        const options = {
          hostname: "api.postcodes.io",
          path: "/postcodes",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        };

        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on("error", reject);
        req.write(postData);
        req.end();
      });

      if (result.result) {
        result.result.forEach((r) => {
          if (r.result) {
            validPostcodes[r.query] = {
              lat: r.result.latitude,
              lng: r.result.longitude,
            };
          }
        });
      }
    } catch (err) {
      console.error(`\nBatch error at ${i}: ${err.message}`);
      await sleep(2000);
      i -= batchSize; // retry
    }

    // Small delay to be nice to postcodes.io
    await sleep(200);
  }

  console.log(`\nFound ${Object.keys(validPostcodes).length} valid ZE postcodes`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(POSTCODES_FILE, JSON.stringify(validPostcodes, null, 2));
  return validPostcodes;
}

// --- ScotLIS Fetching ---

function parseConsideration(consideration) {
  if (!consideration) return { price: null, note: "No data" };

  // Extract numeric price
  const priceMatch = consideration.match(/£([\d,]+)/);
  if (priceMatch) {
    return { price: parseInt(priceMatch[1].replace(/,/g, ""), 10), note: null };
  }

  // Non-numeric considerations
  return { price: null, note: consideration };
}

async function fetchPostcode(postcode) {
  const encoded = encodeURIComponent(postcode);
  const url = `https://scotlis.ros.gov.uk/public/bff/land-register/addresses?postcode=${encoded}`;
  const data = await httpsGet(url);

  const results = [];
  const addresses = data?._embedded?.addresses || [];

  for (const addr of addresses) {
    const address = addr.prettyPrint;
    const titles = addr.titles || [];

    for (const title of titles) {
      const { price, note } = parseConsideration(title.consideration);
      results.push({
        address,
        date: title.entryDate || null,
        price,
        note,
        titleNumber: title.titleNumber || null,
      });
    }
  }

  return results;
}

// --- Progress Management ---

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  }
  return { completed: {}, properties: [] };
}

function saveProgress(progress) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

// --- Export ---

function exportToDataJs(postcodes) {
  const progress = loadProgress();
  const properties = progress.properties;

  console.log(`\nExporting ${properties.length} sales entries...`);

  // Attach lat/lng from postcode
  const entries = properties.map((p) => {
    // Extract postcode from address (last part after final comma)
    const parts = p.address.split(",").map((s) => s.trim());
    const postcode = parts[parts.length - 1];
    const coords = postcodes[postcode] || { lat: null, lng: null };

    const entry = {
      lat: coords.lat,
      lng: coords.lng,
      price: p.price,
      address: p.address,
      date: p.date,
    };

    if (p.note) entry.note = p.note;

    return entry;
  });

  // Filter out entries with no coordinates
  const valid = entries.filter((e) => e.lat !== null && e.lng !== null);
  const noCoords = entries.length - valid.length;
  if (noCoords > 0) {
    console.log(`  Skipped ${noCoords} entries with no coordinates`);
  }

  // Sort by address then date
  valid.sort((a, b) => {
    const addrCmp = a.address.localeCompare(b.address);
    if (addrCmp !== 0) return addrCmp;
    return (a.date || "").localeCompare(b.date || "");
  });

  // Build data.js
  const lines = valid.map((p) => {
    let s = `  { lat: ${p.lat}, lng: ${p.lng}, price: ${p.price}, address: "${p.address}", date: "${p.date}"`;
    if (p.note) s += `, note: "${p.note.replace(/"/g, '\\"')}"`;
    s += " }";
    return s;
  });

  const output = "const properties = [\n" + lines.join(",\n") + "\n];\n";
  fs.writeFileSync(OUTPUT_FILE, output);

  // Stats
  const withPrice = valid.filter((e) => e.price !== null).length;
  const noPrice = valid.filter((e) => e.price === null).length;
  const uniqueAddresses = new Set(valid.map((e) => e.address)).size;

  console.log(`\nExported to data.js:`);
  console.log(`  ${valid.length} total sale entries`);
  console.log(`  ${uniqueAddresses} unique addresses`);
  console.log(`  ${withPrice} with price, ${noPrice} without price`);

  // Show note breakdown
  const notes = {};
  valid.filter((e) => e.note).forEach((e) => {
    notes[e.note] = (notes[e.note] || 0) + 1;
  });
  if (Object.keys(notes).length > 0) {
    console.log(`\n  Non-price considerations:`);
    Object.entries(notes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([note, count]) => {
        console.log(`    "${note}": ${count}`);
      });
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  const postcodes = await fetchAllPostcodes();
  const postcodeList = Object.keys(postcodes);

  if (args.includes("--stats")) {
    const progress = loadProgress();
    const done = Object.keys(progress.completed).length;
    console.log(`Progress: ${done}/${postcodeList.length} postcodes fetched`);
    console.log(`Properties found: ${progress.properties.length}`);
    const remaining = postcodeList.length - done;
    const avgDelay = 20.5; // midpoint of 18-23
    const etaMinutes = Math.round((remaining * avgDelay) / 60);
    console.log(`Estimated time remaining: ${etaMinutes} minutes (${(etaMinutes / 60).toFixed(1)} hours)`);
    return;
  }

  if (args.includes("--export")) {
    exportToDataJs(postcodes);
    return;
  }

  // Fetch mode
  const progress = loadProgress();
  const remaining = postcodeList.filter((pc) => !progress.completed[pc]);

  console.log(`\n${postcodeList.length} total postcodes, ${remaining.length} remaining`);
  console.log(`${progress.properties.length} properties found so far`);
  console.log(`Rate limit: 18-23s between requests\n`);

  if (remaining.length === 0) {
    console.log("All postcodes already fetched! Use --export to generate data.js");
    return;
  }

  const startTime = Date.now();
  let fetchedThisSession = 0;

  for (const postcode of remaining) {
    const idx = postcodeList.indexOf(postcode) + 1;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = fetchedThisSession > 0 ? elapsed / fetchedThisSession : 20.5;
    const eta = Math.round(((remaining.length - fetchedThisSession) * rate) / 60);

    process.stdout.write(
      `\r[${idx}/${postcodeList.length}] ${postcode} — ${progress.properties.length} properties — ETA: ${eta}m    `
    );

    try {
      const results = await fetchPostcode(postcode);
      progress.properties.push(...results);
      progress.completed[postcode] = { count: results.length, time: new Date().toISOString() };
      fetchedThisSession++;

      // Save after each postcode
      saveProgress(progress);
    } catch (err) {
      console.error(`\nError fetching ${postcode}: ${err.message}`);
      // Save progress and continue
      saveProgress(progress);

      // Wait longer on errors (possible rate limit)
      await sleep(30000);
      continue;
    }

    // Random delay
    const delay = randomDelay();
    await sleep(delay);
  }

  console.log(`\n\nDone! Fetched ${fetchedThisSession} postcodes this session.`);
  console.log(`Total properties: ${progress.properties.length}`);
  console.log(`\nRun with --export to generate data.js`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
