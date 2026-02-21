#!/usr/bin/env python3
"""
Fetch Shetland property data by driving Chrome via navigation.
Reads postcodes from cache/postcodes.json, navigates to each ScotLIS URL,
extracts property data, and writes data.js.

Run this while Claude Code is connected to Chrome.
Usage: python3 -u fetch_via_browser.py
"""

import json
import os
import random
import re
import subprocess
import sys
import time

DELAY_MIN = 18
DELAY_MAX = 33
CACHE_DIR = "cache"
POSTCODES_CACHE = os.path.join(CACHE_DIR, "postcodes.json")
PROGRESS_FILE = os.path.join(CACHE_DIR, "browser_progress.json")


def load_postcodes():
    with open(POSTCODES_CACHE) as f:
        return json.load(f)


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"fetched": [], "properties": []}


def save_progress(progress):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def fetch_postcode_via_curl(postcode):
    """Use curl which handles TLS/cookies differently from Python requests."""
    url = f"https://scotlis.ros.gov.uk/public/bff/land-register/addresses?postcode={postcode.lower().replace(' ', '%20')}"
    try:
        result = subprocess.run(
            [
                "curl", "-s", "-L",
                "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "-H", "Accept: application/json, text/plain, */*",
                "-H", "Accept-Language: en-GB,en;q=0.9",
                "-H", "Referer: https://scotlis.ros.gov.uk/",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        body = result.stdout.strip()
        if not body:
            return None

        data = json.loads(body)
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

    except Exception as e:
        print(f"  Error: {e}", file=sys.stderr)
        return None


def write_data_js(properties):
    """Deduplicate and write data.js."""
    by_address = {}
    for p in properties:
        key = p["address"]
        if key not in by_address or p["entryDate"] > by_address[key]["entryDate"]:
            by_address[key] = p

    unique = sorted(by_address.values(), key=lambda p: p["address"])

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

    with open("data.json", "w") as f:
        json.dump(unique, f, indent=2)

    return len(unique)


def main():
    print("=== Shetland Property Fetcher (curl) ===\n")

    postcodes = load_postcodes()
    print(f"Loaded {len(postcodes)} postcodes")

    progress = load_progress()
    already_fetched = set(progress["fetched"])
    all_properties = progress["properties"]

    remaining = [pc for pc in sorted(postcodes.keys()) if pc not in already_fetched]
    print(f"Already fetched: {len(already_fetched)}, remaining: {len(remaining)}")
    print(f"Properties found so far: {len(all_properties)}\n")

    if not remaining:
        print("All postcodes already fetched!")
        count = write_data_js(all_properties)
        print(f"Wrote {count} unique properties to data.js")
        return

    # Quick test
    print("Testing connection...")
    test = fetch_postcode_via_curl("ZE1 0EN")
    if test is None:
        print("ERROR: Cannot reach ScotLIS. Check your connection.")
        sys.exit(1)
    print(f"Test OK - got {len(test)} properties for ZE1 0EN\n")

    with_data = 0
    for i, pc in enumerate(remaining):
        props = fetch_postcode_via_curl(pc)

        if props is None:
            # Rate limited or error - wait longer and retry once
            print(f"  {pc}: rate limited, waiting 120s...")
            time.sleep(120)
            props = fetch_postcode_via_curl(pc)

        if props is None:
            print(f"  {pc}: FAILED after retry, skipping")
            progress["fetched"].append(pc)
            continue

        if props:
            with_data += 1
            coords = postcodes[pc]
            for p in props:
                p["lat"] = coords["lat"]
                p["lng"] = coords["lng"]
            all_properties.extend(props)

        progress["fetched"].append(pc)
        progress["properties"] = all_properties

        total_done = len(already_fetched) + i + 1
        if (i + 1) % 10 == 0 or i == len(remaining) - 1:
            save_progress(progress)
            print(
                f"  [{total_done}/{len(postcodes)}] "
                f"{with_data} with data | {len(all_properties)} total properties"
            )

        delay = random.uniform(DELAY_MIN, DELAY_MAX)
        time.sleep(delay)

    print(f"\nTotal properties: {len(all_properties)}")
    count = write_data_js(all_properties)
    print(f"Wrote {count} unique properties to data.js")
    print("Done!")


if __name__ == "__main__":
    main()
