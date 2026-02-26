#!/usr/bin/env node

/**
 * Kelvin Anderson (eXp) Property Scraper
 *
 * Scrapes sold gallery and active listings from kelvinanderson.exp.uk.com.
 *
 * Usage:
 *   node fetch_kelvin.js --sold       # Scrape sold gallery (13 pages)
 *   node fetch_kelvin.js --active     # Scrape current listings
 *   node fetch_kelvin.js --stats      # Show counts
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const CACHE_DIR = path.join(__dirname, "cache");
const SOLD_CACHE = path.join(CACHE_DIR, "kelvin_sold.json");
const ACTIVE_CACHE = path.join(CACHE_DIR, "kelvin_active.json");

const BASE_URL = "https://kelvinanderson.exp.uk.com";
const SOLD_PATH = "/sold-gallery/";
const ACTIVE_PATH = "/properties-for-sale/";

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return 2000 + Math.random() * 1000;
}

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
          // Follow redirect
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${BASE_URL}${res.headers.location}`;
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

function parseDetails(detailsText) {
  const result = { bedrooms: null, propertyType: null };
  if (!detailsText) return result;

  const bedroomMatch = detailsText.match(/(\d+)\s*bedroom/i);
  if (bedroomMatch) result.bedrooms = parseInt(bedroomMatch[1], 10);

  // Property type is after the pipe
  const parts = detailsText.split("|");
  if (parts.length > 1) {
    result.propertyType = parts[1].trim();
  }

  return result;
}

// --- Parsing ---

function parseCards(html, source) {
  const $ = cheerio.load(html);
  const listings = [];

  $(".single-product-item").each((i, el) => {
    const card = $(el);
    const badge = card.find(".badge").text().trim().toLowerCase();
    const address = card.find(".product-content h2").text().trim();
    const details = card.find(".product-content > p").first().text().trim();
    const priceType = card.find(".price-inner h4").text().trim();
    const priceText = card.find(".price-inner p").text().trim();

    if (!address) return;

    const postcode = extractPostcode(address);
    const price = parsePrice(priceText);
    const { bedrooms, propertyType } = parseDetails(details);

    let status = "for_sale";
    if (badge === "sold") status = "sold";
    else if (badge.includes("under offer")) status = "under_offer";

    listings.push({
      address,
      postcode,
      askingPrice: price,
      askingType: parsePriceType(priceType),
      bedrooms,
      propertyType,
      agent: "Kelvin Anderson",
      source,
      dateScraped: new Date().toISOString().split("T")[0],
      status,
    });
  });

  return listings;
}

function getMaxPage(html) {
  const $ = cheerio.load(html);
  let maxPage = 1;
  $("a").each((i, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/prop_page=(\d+)/);
    if (match) {
      const page = parseInt(match[1], 10);
      if (page > maxPage) maxPage = page;
    }
  });
  return maxPage;
}

// --- Scrape modes ---

async function scrapeSold() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("Scraping Kelvin Anderson sold gallery...\n");

  // Fetch page 1 to discover total pages
  const firstUrl = `${BASE_URL}${SOLD_PATH}?prop_page=1`;
  console.log(`Fetching page 1...`);
  const firstHtml = await fetchPage(firstUrl);
  const maxPage = getMaxPage(firstHtml);
  console.log(`Found ${maxPage} pages\n`);

  let allListings = parseCards(firstHtml, "kelvin_sold");
  console.log(`  Page 1: ${allListings.length} properties`);

  for (let page = 2; page <= maxPage; page++) {
    await sleep(randomDelay());
    const url = `${BASE_URL}${SOLD_PATH}?prop_page=${page}`;
    process.stdout.write(`  Page ${page}/${maxPage}...`);

    try {
      const html = await fetchPage(url);
      const listings = parseCards(html, "kelvin_sold");
      allListings.push(...listings);
      console.log(` ${listings.length} properties`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  // Filter to Shetland only (ZE postcodes)
  const shetlandOnly = allListings.filter((l) => l.postcode && l.postcode.startsWith("ZE"));
  const nonShetland = allListings.length - shetlandOnly.length;

  fs.writeFileSync(SOLD_CACHE, JSON.stringify(shetlandOnly, null, 2));

  console.log(`\nDone! Scraped ${allListings.length} total properties.`);
  if (nonShetland > 0) console.log(`  Filtered out ${nonShetland} non-Shetland properties.`);
  console.log(`  Saved ${shetlandOnly.length} Shetland properties to ${path.basename(SOLD_CACHE)}`);
}

async function scrapeActive() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("Scraping Kelvin Anderson active listings...\n");

  const firstUrl = `${BASE_URL}${ACTIVE_PATH}?prop_page=1`;
  console.log(`Fetching page 1...`);
  const firstHtml = await fetchPage(firstUrl);
  const maxPage = getMaxPage(firstHtml);
  console.log(`Found ${maxPage} pages\n`);

  let allListings = parseCards(firstHtml, "kelvin_active");
  console.log(`  Page 1: ${allListings.length} properties`);

  for (let page = 2; page <= maxPage; page++) {
    await sleep(randomDelay());
    const url = `${BASE_URL}${ACTIVE_PATH}?prop_page=${page}`;
    process.stdout.write(`  Page ${page}/${maxPage}...`);

    try {
      const html = await fetchPage(url);
      const listings = parseCards(html, "kelvin_active");
      allListings.push(...listings);
      console.log(` ${listings.length} properties`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  const shetlandOnly = allListings.filter((l) => l.postcode && l.postcode.startsWith("ZE"));
  const nonShetland = allListings.length - shetlandOnly.length;

  fs.writeFileSync(ACTIVE_CACHE, JSON.stringify(shetlandOnly, null, 2));

  console.log(`\nDone! Scraped ${allListings.length} total properties.`);
  if (nonShetland > 0) console.log(`  Filtered out ${nonShetland} non-Shetland properties.`);
  console.log(`  Saved ${shetlandOnly.length} Shetland properties to ${path.basename(ACTIVE_CACHE)}`);
}

function showStats() {
  console.log("Kelvin Anderson scraper stats:\n");

  if (fs.existsSync(SOLD_CACHE)) {
    const sold = JSON.parse(fs.readFileSync(SOLD_CACHE, "utf8"));
    console.log(`Sold gallery: ${sold.length} properties`);

    const priceTypes = {};
    sold.forEach((l) => {
      priceTypes[l.askingType || "unknown"] = (priceTypes[l.askingType || "unknown"] || 0) + 1;
    });
    console.log(`  Price types: ${JSON.stringify(priceTypes)}`);

    const withPrice = sold.filter((l) => l.askingPrice !== null).length;
    console.log(`  With price: ${withPrice}, without: ${sold.length - withPrice}`);
  } else {
    console.log("Sold gallery: not yet scraped");
  }

  console.log();

  if (fs.existsSync(ACTIVE_CACHE)) {
    const active = JSON.parse(fs.readFileSync(ACTIVE_CACHE, "utf8"));
    console.log(`Active listings: ${active.length} properties`);

    const statuses = {};
    active.forEach((l) => {
      statuses[l.status] = (statuses[l.status] || 0) + 1;
    });
    console.log(`  Statuses: ${JSON.stringify(statuses)}`);
  } else {
    console.log("Active listings: not yet scraped");
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    showStats();
    return;
  }

  if (args.includes("--sold")) {
    await scrapeSold();
    return;
  }

  if (args.includes("--active")) {
    await scrapeActive();
    return;
  }

  console.log("Usage:");
  console.log("  node fetch_kelvin.js --sold     Scrape sold gallery");
  console.log("  node fetch_kelvin.js --active   Scrape current listings");
  console.log("  node fetch_kelvin.js --stats    Show counts");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
