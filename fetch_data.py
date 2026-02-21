#!/usr/bin/env python3
"""
Fetch Shetland property price data from ScotLIS and geocode via postcodes.io.
Outputs data.js for the map application.

Resumes from cached postcode list and already-fetched results if available.
"""

import json
import os
import random
import re
import time
import sys
import requests

SCOTLIS_DELAY_MIN = 18  # Random delay between 18-33s to mimic human browsing
SCOTLIS_DELAY_MAX = 33
POSTCODES_IO_DELAY = 0.15
CACHE_DIR = "cache"
POSTCODES_CACHE = os.path.join(CACHE_DIR, "postcodes.json")
PROGRESS_CACHE = os.path.join(CACHE_DIR, "progress.json")

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://scotlis.ros.gov.uk/",
})


def ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def get_all_ze_postcodes():
    """Enumerate all valid ZE postcodes via postcodes.io bulk validation."""
    if os.path.exists(POSTCODES_CACHE):
        with open(POSTCODES_CACHE) as f:
            cached = json.load(f)
        print(f"  Loaded {len(cached)} postcodes from cache")
        return cached

    letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    valid = {}

    for outcode in ["ZE1", "ZE2", "ZE3"]:
        for sector in range(10):
            candidates = [f"{outcode} {sector}{l1}{l2}" for l1 in letters for l2 in letters]

            for i in range(0, len(candidates), 100):
                batch = candidates[i : i + 100]
                try:
                    resp = SESSION.post(
                        "https://api.postcodes.io/postcodes",
                        json={"postcodes": batch},
                        timeout=15,
                    )
                    data = resp.json()
                    for item in data.get("result", []):
                        if item.get("result"):
                            r = item["result"]
                            valid[r["postcode"]] = {
                                "lat": r["latitude"],
                                "lng": r["longitude"],
                            }
                except Exception as e:
                    print(f"  Error validating batch: {e}", file=sys.stderr)
                time.sleep(POSTCODES_IO_DELAY)

            print(f"  {outcode} {sector}xx: {len(valid)} valid postcodes so far")

    # Cache for reuse
    ensure_cache_dir()
    with open(POSTCODES_CACHE, "w") as f:
        json.dump(valid, f)
    print(f"  Cached postcodes to {POSTCODES_CACHE}")

    return valid


def fetch_scotlis_properties(postcode, max_retries=3):
    """Fetch properties for a postcode from ScotLIS with retry logic."""
    url = "https://scotlis.ros.gov.uk/public/bff/land-register/addresses"

    for attempt in range(max_retries):
        try:
            resp = SESSION.get(url, params={"postcode": postcode.lower()}, timeout=15)

            if resp.status_code == 202 or not resp.text.strip():
                # Rate limited - back off aggressively
                wait = 60 * (attempt + 1)  # 1min, 2min, 3min
                print(f"  Rate limited on {postcode}, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                print(f"  HTTP {resp.status_code} for {postcode}", file=sys.stderr)
                return []

            data = resp.json()
        except Exception as e:
            print(f"  Error fetching {postcode} (attempt {attempt+1}): {e}", file=sys.stderr)
            time.sleep(3)
            continue

        if "_embedded" not in data:
            return []

        properties = []
        for addr in data["_embedded"].get("addresses", []):
            address = addr.get("prettyPrint", "")
            for title in addr.get("titles", []):
                consideration = title.get("consideration", "")
                entry_date = title.get("entryDate", "")

                price_match = re.search(r"£([\d,]+)", consideration)
                if not price_match:
                    continue

                price = int(price_match.group(1).replace(",", ""))
                if price < 5000:
                    continue

                properties.append({
                    "address": address,
                    "price": price,
                    "entryDate": entry_date,
                    "postcode": postcode,
                })

        return properties

    print(f"  Failed after {max_retries} retries for {postcode}", file=sys.stderr)
    return []


def load_progress():
    """Load previously fetched results so we can resume."""
    if os.path.exists(PROGRESS_CACHE):
        with open(PROGRESS_CACHE) as f:
            return json.load(f)
    return {"fetched_postcodes": [], "properties": []}


def save_progress(progress):
    """Save progress to disk."""
    ensure_cache_dir()
    with open(PROGRESS_CACHE, "w") as f:
        json.dump(progress, f)


def main():
    print("=== Shetland Property Price Data Fetcher ===\n")
    ensure_cache_dir()

    # Step 1: Get all valid ZE postcodes with coordinates
    print("Step 1: Finding all valid Shetland postcodes...")
    valid_postcodes = get_all_ze_postcodes()
    print(f"\n  Found {len(valid_postcodes)} valid postcodes\n")

    # Step 2: Fetch property data from ScotLIS (with resume support)
    print(f"Step 2: Fetching property data from ScotLIS...")
    progress = load_progress()
    already_fetched = set(progress["fetched_postcodes"])
    all_properties = progress["properties"]

    postcodes_list = sorted(valid_postcodes.keys())
    remaining = [pc for pc in postcodes_list if pc not in already_fetched]

    if already_fetched:
        print(f"  Resuming: {len(already_fetched)} already done, {len(remaining)} remaining")
        print(f"  {len(all_properties)} properties found so far")

    with_data = sum(1 for pc in already_fetched if any(p["postcode"] == pc for p in all_properties))

    for i, pc in enumerate(remaining):
        props = fetch_scotlis_properties(pc)
        if props:
            with_data += 1
            coords = valid_postcodes[pc]
            for p in props:
                p["lat"] = coords["lat"]
                p["lng"] = coords["lng"]
            all_properties.extend(props)

        progress["fetched_postcodes"].append(pc)
        progress["properties"] = all_properties

        total_done = len(already_fetched) + i + 1
        if (i + 1) % 50 == 0 or i == len(remaining) - 1:
            save_progress(progress)
            print(
                f"  Processed {total_done}/{len(postcodes_list)} postcodes | "
                f"{with_data} with data | {len(all_properties)} properties with prices"
            )
        time.sleep(random.uniform(SCOTLIS_DELAY_MIN, SCOTLIS_DELAY_MAX))

    print(f"\n  Total properties with prices: {len(all_properties)}")

    # Step 3: Deduplicate by address (keep most recent entry)
    print("\nStep 3: Deduplicating...")
    by_address = {}
    for p in all_properties:
        key = p["address"]
        if key not in by_address or p["entryDate"] > by_address[key]["entryDate"]:
            by_address[key] = p

    unique = sorted(by_address.values(), key=lambda p: p["address"])
    print(f"  {len(unique)} unique properties after dedup")

    # Step 4: Write data.js
    print("\nStep 4: Writing data.js...")
    lines = ["const properties = ["]
    for p in unique:
        addr = p["address"].replace("\\", "\\\\").replace('"', '\\"')
        lines.append(
            f'  {{ lat: {p["lat"]}, lng: {p["lng"]}, price: {p["price"]}, '
            f'address: "{addr}", date: "{p["entryDate"]}" }},'
        )
    lines.append("];")

    with open("data.js", "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  Wrote {len(unique)} properties to data.js")

    # Also save raw JSON
    with open("data.json", "w") as f:
        json.dump(unique, f, indent=2)
    print(f"  Wrote raw data to data.json")

    print("\nDone!")


if __name__ == "__main__":
    main()
