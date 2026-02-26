#!/usr/bin/env node

/**
 * Tait & Peterson Property Scraper
 *
 * Scrapes active and sold listings from tait-peterson.co.uk.
 * All properties are on a single page, separated by section headings.
 *
 * Usage:
 *   node fetch_tait.js              # Scrape all listings
 *   node fetch_tait.js --stats      # Show counts
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_FILE = path.join(CACHE_DIR, "tait_all.json");

const URL = "https://www.tait-peterson.co.uk/properties";

// --- Helpers ---

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new globalThis.URL(res.headers.location, url).href;
          fetchPage(redirectUrl).then(resolve).catch(reject);
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout for ${url}`));
    });
  });
}

function extractPostcode(address) {
  const match = address.match(/\b(ZE[1-3]\s*\d[A-Z]{2})\b/i);
  return match ? match[1].toUpperCase().replace(/\s+/, " ") : null;
}

function parsePrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/£(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parsePriceType(priceText) {
  if (!priceText) return null;
  const lower = priceText.toLowerCase();
  if (lower.includes("offers over")) return "offers_over";
  if (lower.includes("offers in the region of")) return "offers_in_region";
  if (lower.includes("fixed price")) return "fixed_price";
  if (lower.includes("offers around")) return "offers_around";
  if (lower.includes("guide price")) return "guide_price";
  return null;
}

function parseBedrooms(detailSpans) {
  for (const text of detailSpans) {
    const match = text.match(/(\d+)\s*bedroom/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

// --- Parsing ---

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];

  // The page has section headings (h3) that separate categories:
  // "Shetland Properties For Sale", "Commercial Property", "Land",
  // "Shetland Properties For Rent", "Recently Sold"
  // Properties are in <ul> elements, each with 2 <li> children (image card + details card)

  let currentSection = "for_sale";

  // Walk through all elements in order to track which section we're in
  const mainContent = $("h3, ul").toArray();

  for (const el of mainContent) {
    if (el.tagName === "h3") {
      const text = $(el).text().trim().toLowerCase();
      // Only update section for non-property headings (those not inside <li>)
      if ($(el).parent().is("li")) continue;

      if (text.includes("for sale")) currentSection = "for_sale";
      else if (text.includes("commercial")) currentSection = "commercial";
      else if (text.includes("land")) currentSection = "land";
      else if (text.includes("for rent") || text.includes("for let")) currentSection = "rental";
      else if (text.includes("recently sold") || text.includes("sold")) currentSection = "sold";
      continue;
    }

    // Process <ul> elements that contain property cards
    const items = $(el).children("li");
    if (items.length !== 2) continue;

    const firstLi = $(items[0]);
    const secondLi = $(items[1]);

    // Check if this looks like a property card (has an h3 in second li)
    const heading = secondLi.find("h3").first();
    if (!heading.length) continue;

    const address = heading.text().trim();
    if (!address) continue;

    // Status from the badge
    const tag = firstLi.find(".tag");
    const tagText = tag.length ? tag.text().trim().toLowerCase() : "";
    let status = "for_sale";
    if (tagText === "sold" || currentSection === "sold") status = "sold";
    else if (tagText.includes("under offer")) status = "under_offer";

    // Skip non-residential (commercial, land, rental)
    if (currentSection === "commercial" || currentSection === "rental") continue;

    // Price info is in a <p> element inside the second li
    const priceP = secondLi.find("p");
    const priceText = priceP.length ? priceP.text().trim() : null;

    // Details
    const detailTexts = [];
    secondLi.find(".detail").each((i, d) => {
      detailTexts.push($(d).text().trim());
    });

    const postcode = extractPostcode(address);
    const askingPrice = parsePrice(priceText);
    const askingType = parsePriceType(priceText);
    const bedrooms = parseBedrooms(detailTexts);

    // Determine if it's land (no bedrooms, in land section, or address suggests it)
    const isLand = currentSection === "land";

    listings.push({
      address,
      postcode,
      askingPrice,
      askingType,
      bedrooms,
      propertyType: isLand ? "Land" : null,
      agent: "Tait & Peterson",
      source: status === "sold" ? "tait_sold" : "tait_active",
      dateScraped: new Date().toISOString().split("T")[0],
      status,
    });
  }

  return listings;
}

// --- Main ---

async function scrape() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("Scraping Tait & Peterson listings...\n");

  const html = await fetchPage(URL);
  const listings = parseListings(html);

  // Filter to properties with ZE postcodes or in Shetland
  const shetlandOnly = listings.filter(
    (l) => l.postcode && l.postcode.startsWith("ZE")
  );
  const noPostcode = listings.filter((l) => !l.postcode);

  fs.writeFileSync(CACHE_FILE, JSON.stringify(shetlandOnly, null, 2));

  const sold = shetlandOnly.filter((l) => l.status === "sold");
  const active = shetlandOnly.filter((l) => l.status !== "sold");

  console.log(`Done! Scraped ${listings.length} total properties.`);
  if (noPostcode.length > 0) {
    console.log(`  Skipped ${noPostcode.length} without ZE postcode:`);
    noPostcode.forEach((l) => console.log(`    - ${l.address}`));
  }
  console.log(`  Active: ${active.length} (${active.filter((l) => l.status === "under_offer").length} under offer)`);
  console.log(`  Sold: ${sold.length}`);
  console.log(`  Saved ${shetlandOnly.length} properties to ${path.basename(CACHE_FILE)}`);
}

function showStats() {
  console.log("Tait & Peterson scraper stats:\n");

  if (fs.existsSync(CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    const sold = data.filter((l) => l.status === "sold");
    const active = data.filter((l) => l.status !== "sold");

    console.log(`Total: ${data.length} properties`);
    console.log(`  Active: ${active.length}`);
    console.log(`  Sold: ${sold.length}`);

    const priceTypes = {};
    data.forEach((l) => {
      priceTypes[l.askingType || "unknown"] = (priceTypes[l.askingType || "unknown"] || 0) + 1;
    });
    console.log(`  Price types: ${JSON.stringify(priceTypes)}`);

    const withPrice = data.filter((l) => l.askingPrice !== null).length;
    console.log(`  With price: ${withPrice}, without: ${data.length - withPrice}`);
  } else {
    console.log("Not yet scraped. Run: node fetch_tait.js");
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    showStats();
    return;
  }

  await scrape();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
