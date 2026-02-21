#!/usr/bin/env python3
"""
Fetch Shetland property price data from ScotLIS and geocode via postcodes.io.
Outputs data.js for the map application.
"""

import json
import re
import time
import sys
import requests

SCOTLIS_DELAY = 0.3
POSTCODES_IO_DELAY = 0.15
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "ShetlandPropertyMap/1.0"


def get_all_ze_postcodes():
    """Enumerate all valid ZE postcodes via postcodes.io bulk validation."""
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

    return valid


def fetch_scotlis_properties(postcode):
    """Fetch properties for a postcode from ScotLIS."""
    url = "https://scotlis.ros.gov.uk/public/bff/land-register/addresses"
    try:
        resp = SESSION.get(url, params={"postcode": postcode.lower()}, timeout=15)
        data = resp.json()
    except Exception as e:
        print(f"  Error fetching {postcode}: {e}", file=sys.stderr)
        return []

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


def main():
    print("=== Shetland Property Price Data Fetcher ===\n")

    # Step 1: Get all valid ZE postcodes with coordinates
    print("Step 1: Finding all valid Shetland postcodes...")
    valid_postcodes = get_all_ze_postcodes()
    print(f"\n  Found {len(valid_postcodes)} valid postcodes\n")

    # Step 2: Fetch property data from ScotLIS
    print(f"Step 2: Fetching property data from ScotLIS...")
    all_properties = []
    postcodes_list = sorted(valid_postcodes.keys())
    with_data = 0

    for i, pc in enumerate(postcodes_list):
        props = fetch_scotlis_properties(pc)
        if props:
            with_data += 1
            coords = valid_postcodes[pc]
            for p in props:
                p["lat"] = coords["lat"]
                p["lng"] = coords["lng"]
            all_properties.extend(props)

        if (i + 1) % 100 == 0 or i == len(postcodes_list) - 1:
            print(
                f"  Processed {i + 1}/{len(postcodes_list)} postcodes | "
                f"{with_data} with data | {len(all_properties)} properties with prices"
            )
        time.sleep(SCOTLIS_DELAY)

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
