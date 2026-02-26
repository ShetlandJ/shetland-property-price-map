#!/usr/bin/env node

/**
 * Arthur Simpson (Lifesycle) Property Scraper
 *
 * Scrapes current listings from arthursimpson.web.lifesycle.co.uk.
 * The site is a Nuxt.js SSR app — we parse the server-rendered HTML.
 *
 * Usage:
 *   node fetch_arthur.js              # Scrape current listings (sold + active)
 *   node fetch_arthur.js --stats      # Show counts
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const CACHE_DIR = path.join(__dirname, "cache");
const ACTIVE_CACHE = path.join(CACHE_DIR, "arthur_active.json");

const BASE_HOST = "arthursimpson.web.lifesycle.co.uk";

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchPage(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_HOST,
      path: urlPath,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    };

    const req = https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const newPath = loc.startsWith("http")
          ? new URL(loc).pathname + new URL(loc).search
          : loc;
        fetchPage(newPath).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

function extractPostcode(address) {
  const match = address.match(/\b(ZE[1-3]\s*\d[A-Z]{2})\b/i);
  return match ? match[1].toUpperCase().replace(/\s+/, " ") : null;
}

function parsePrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/£([\d,]+)/);
  return match ? parseInt(match[1].replace(/,/g, ""), 10) : null;
}

function parsePriceType(typeText) {
  if (!typeText) return null;
  const lower = typeText.toLowerCase().trim();
  if (lower.includes("offers over")) return "offers_over";
  if (lower.includes("fixed price")) return "fixed_price";
  if (lower.includes("offers around")) return "offers_around";
  if (lower.includes("guide price")) return "guide_price";
  return lower.replace(/\s+/g, "_");
}

// --- Parsing ---

function parseNuxtState(html) {
  // Try to extract __NUXT__ state which contains all property data
  const match = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!match) return null;

  try {
    // The __NUXT__ state may use JS syntax (undefined, etc.), so we can't just JSON.parse
    // Fall back to HTML parsing
    return null;
  } catch (e) {
    return null;
  }
}

function parseCardsFromHtml(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $(".property-card").each((i, el) => {
    const card = $(el);

    // Price: first span inside .price-information
    const priceText = card.find(".price-information span").first().text().trim();
    // Price type: span with class pm-fs-12 and ls-capitalized
    const priceTypeText = card.find(".pm-fs-12.ls-capitalized").text().trim();
    // Address: h4 element
    const address = card.find("h4").first().text().trim();

    if (!address) return;

    // Under offer: check for .pm-tag containing "Under Offer"
    let status = "for_sale";
    card.find(".pm-tag").each((j, tag) => {
      const tagText = $(tag).text().trim();
      if (tagText.includes("Under Offer")) status = "under_offer";
      if (tagText.includes("Sold")) status = "sold";
    });

    // Extract bedrooms from teaser text if possible
    const teaser = card.find(".teaser").text().trim();
    let bedrooms = null;
    let propertyType = null;
    const bedroomMatch = teaser.match(/(\d+)-bedroom/i) || teaser.match(/(\w+)-bedroom/i);
    if (bedroomMatch) {
      const num = parseInt(bedroomMatch[1], 10);
      if (!isNaN(num)) bedrooms = num;
      else {
        const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
        bedrooms = words[bedroomMatch[1].toLowerCase()] || null;
      }
    }
    // Try to extract property type from teaser
    const typeMatch = teaser.match(
      /\b(detached house|semi-detached|terraced|bungalow|flat|cottage|maisonette|end of terrace)\b/i
    );
    if (typeMatch) propertyType = typeMatch[1];

    const postcode = extractPostcode(address);

    listings.push({
      address,
      postcode,
      askingPrice: parsePrice(priceText),
      askingType: parsePriceType(priceTypeText),
      bedrooms,
      propertyType,
      agent: "Arthur Simpson",
      source: "arthur_active",
      dateScraped: new Date().toISOString().split("T")[0],
      status,
    });
  });

  return listings;
}

// --- Scrape ---

async function scrapeListings() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("Scraping Arthur Simpson listings...\n");

  // Fetch sold/unavailable properties
  const soldUrl =
    "/properties?search_type=sales&is_available=false&sort=-added_at";
  console.log("Fetching sold/unavailable listings...");
  const soldHtml = await fetchPage(soldUrl);
  const soldListings = parseCardsFromHtml(soldHtml);
  console.log(`  Found ${soldListings.length} sold/unavailable properties`);

  await sleep(2000 + Math.random() * 1000);

  // Fetch active/available properties
  const activeUrl =
    "/properties?search_type=sales&is_available=true&sort=-added_at";
  console.log("Fetching active listings...");
  const activeHtml = await fetchPage(activeUrl);
  const activeListings = parseCardsFromHtml(activeHtml);
  console.log(`  Found ${activeListings.length} active properties`);

  const allListings = [...soldListings, ...activeListings];

  // Filter to Shetland only
  const shetlandOnly = allListings.filter(
    (l) => l.postcode && l.postcode.startsWith("ZE")
  );
  const nonShetland = allListings.length - shetlandOnly.length;

  fs.writeFileSync(ACTIVE_CACHE, JSON.stringify(shetlandOnly, null, 2));

  console.log(`\nDone! Scraped ${allListings.length} total properties.`);
  if (nonShetland > 0)
    console.log(`  Filtered out ${nonShetland} non-Shetland properties.`);
  console.log(
    `  Saved ${shetlandOnly.length} Shetland properties to ${path.basename(ACTIVE_CACHE)}`
  );
}

function showStats() {
  console.log("Arthur Simpson scraper stats:\n");

  if (fs.existsSync(ACTIVE_CACHE)) {
    const listings = JSON.parse(fs.readFileSync(ACTIVE_CACHE, "utf8"));
    console.log(`Total listings: ${listings.length}`);

    const statuses = {};
    listings.forEach((l) => {
      statuses[l.status] = (statuses[l.status] || 0) + 1;
    });
    console.log(`  Statuses: ${JSON.stringify(statuses)}`);

    const priceTypes = {};
    listings.forEach((l) => {
      priceTypes[l.askingType || "unknown"] =
        (priceTypes[l.askingType || "unknown"] || 0) + 1;
    });
    console.log(`  Price types: ${JSON.stringify(priceTypes)}`);

    const withPrice = listings.filter((l) => l.askingPrice !== null).length;
    console.log(`  With price: ${withPrice}, without: ${listings.length - withPrice}`);
  } else {
    console.log("Not yet scraped. Run: node fetch_arthur.js");
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    showStats();
    return;
  }

  await scrapeListings();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
