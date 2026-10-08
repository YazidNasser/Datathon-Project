#!/usr/bin/env python3
"""
Turn the VPD GeoDASH crime CSV into a small data.json that the website loads.

Usage (run from the repository root):
    python scripts/prepare_data.py                       # uses every .csv in data/raw/ (subfolders too)
    python scripts/prepare_data.py data/raw/myfile.csv   # or point to specific files
    python scripts/prepare_data.py --year 2026           # show one calendar year only
    python scripts/prepare_data.py --out web/data.json

What it does:
  1. Reads the VPD CSV (columns: TYPE, YEAR, MONTH, DAY, HOUR, MINUTE,
     HUNDRED_BLOCK, NEIGHBOURHOOD, X, Y)
  2. Drops rows with no location (VPD sets X and Y to 0 for privacy)
     and rows that fall outside Vancouver
  3. Converts X/Y from UTM zone 10N metres to latitude/longitude
  4. Keeps two 12-month windows ending on the latest date in the data:
     "last 12 months" (shown on the map) and "previous 12 months" (for comparison),
     or with --year, just that one calendar year
  5. Renames VPD crime types to plain-language labels
  6. Writes web/data.json and prints a summary you can use to check the app

Only the Python standard library is needed.
"""

import argparse
import csv
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_OUT = REPO_ROOT / "web" / "data.json"

# VPD type name -> label shown in the app. Unknown types keep their VPD name.
TYPE_LABELS = {
    "Theft of Bicycle": "Bike theft",
    "Theft from Vehicle": "Theft from cars",
    "Theft of Vehicle": "Car theft",
    "Break and Enter Residential/Other": "Home break-ins",
    "Break and Enter Commercial": "Business break-ins",
    "Other Theft": "Other theft",
    "Mischief": "Mischief and vandalism",
    "Offence Against a Person": "Offences against a person",
    "Homicide": "Homicide",
    "Vehicle Collision or Pedestrian Struck (with Injury)": "Traffic collisions with injury",
    "Vehicle Collision or Pedestrian Struck (with Fatality)": "Fatal traffic collisions",
}

# VPD randomizes these locations across several blocks, so the app flags them as area-level only.
BLURRED_TYPES = {"Offence Against a Person", "Homicide"}

# Rough box around the City of Vancouver; anything outside is treated as bad data.
LAT_RANGE = (49.19, 49.32)
LNG_RANGE = (-123.28, -123.00)

WINDOW_DAYS = 365


# --- UTM zone 10N (NAD83 / GRS80) to latitude/longitude ----------------------
# Standard inverse transverse Mercator series (USGS, Snyder 1987).
# Accurate to well under a metre for Vancouver, far finer than VPD's location offsets.
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9996
_LON0 = math.radians(-123.0)  # central meridian of zone 10
_E1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))


def utm10n_to_latlng(easting, northing):
    x = easting - 500000.0
    m = northing / _K0
    mu = m / (_A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256))
    phi1 = (
        mu
        + (3 * _E1 / 2 - 27 * _E1**3 / 32) * math.sin(2 * mu)
        + (21 * _E1**2 / 16 - 55 * _E1**4 / 32) * math.sin(4 * mu)
        + (151 * _E1**3 / 96) * math.sin(6 * mu)
        + (1097 * _E1**4 / 512) * math.sin(8 * mu)
    )
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = _EP2 * cos1**2
    t1 = tan1**2
    n1 = _A / math.sqrt(1 - _E2 * sin1**2)
    r1 = _A * (1 - _E2) / (1 - _E2 * sin1**2) ** 1.5
    d = x / (n1 * _K0)
    lat = phi1 - (n1 * tan1 / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720
    )
    lng = _LON0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120
    ) / cos1
    return math.degrees(lat), math.degrees(lng)


# --- Helpers ------------------------------------------------------------------
def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value):
    f = to_float(value)
    return None if f is None else int(f)


def row_date(row):
    y, m, d = to_int(row.get("YEAR")), to_int(row.get("MONTH")), to_int(row.get("DAY"))
    if not (y and m and d):
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def read_rows(paths):
    for path in paths:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            reader.fieldnames = [name.strip().upper() for name in reader.fieldnames]
            missing = {"TYPE", "YEAR", "MONTH", "DAY", "X", "Y"} - set(reader.fieldnames)
            if missing:
                sys.exit(f"{path.name} is missing expected columns: {', '.join(sorted(missing))}")
            for row in reader:
                yield row


def find_default_csvs():
    csvs = sorted(DEFAULT_RAW_DIR.rglob("*.csv"))
    if not csvs:
        sys.exit(
            f"No CSV found in {DEFAULT_RAW_DIR}.\n"
            "Download the crime data from https://geodash.vpd.ca/opendata/ "
            "and unzip it into data/raw/."
        )
    return csvs


# --- Main ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", nargs="*", help="VPD crime CSV file(s) (default: every .csv in data/raw/)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Where to write data.json (default: web/data.json)")
    parser.add_argument("--year", type=int, help="Show one calendar year only, e.g. 2026 (no year-over-year comparison)")
    args = parser.parse_args()

    src = [Path(p) for p in args.csv] if args.csv else find_default_csvs()
    out = Path(args.out)
    print("Reading:")
    for path in src:
        print(f"  {path}")
    names = " ".join(p.name.lower() for p in src)
    if "allyears" in names and len(src) > 1:
        print("\nWarning: you have an all-years file plus other files, so incidents may be counted twice. "
              "Keep only one set in data/raw/.")

    # Pass 1: find the latest date in the data so the windows end there.
    latest = None
    for row in read_rows(src):
        d = row_date(row)
        if d and (args.year is None or d.year == args.year) and (latest is None or d > latest):
            latest = d
    if latest is None:
        sys.exit(f"Couldn't find any valid dates{f' in {args.year}' if args.year else ''} in the CSV.")

    if args.year:
        # Single-year mode: everything in that year is shown, nothing to compare against.
        shown_start = date(args.year, 1, 1)
        period_label = f"in {args.year}"
        compare = False

        def classify(d):
            return 0 if d.year == args.year else None
    else:
        # Default: last 12 months on the map, previous 12 months for comparison.
        last_start = latest - timedelta(days=WINDOW_DAYS)      # last window: (last_start, latest]
        prev_start = last_start - timedelta(days=WINDOW_DAYS)  # previous window: (prev_start, last_start]
        shown_start = last_start + timedelta(days=1)
        period_label = "in the last 12 months"
        compare = True

        def classify(d):
            if prev_start < d <= latest:
                return 0 if d > last_start else 1
            return None

    # Pass 2: filter, convert, and collect points.
    stats = Counter()
    type_index = {}
    types = []
    points = []
    hood_sums = defaultdict(lambda: [0.0, 0.0, 0])
    last_counts_by_type = Counter()

    for row in read_rows(src):
        stats["rows read"] += 1
        d = row_date(row)
        if d is None:
            stats["skipped: bad date"] += 1
            continue
        period = classify(d)
        if period is None:
            stats["skipped: outside the date range"] += 1
            continue

        vpd_type = (row.get("TYPE") or "").strip() or "Unknown"
        x, y = to_float(row.get("X")), to_float(row.get("Y"))
        if not x or not y:
            stats["skipped: no location (privacy)"] += 1
            if period == 0:
                stats["no location, in the shown period"] += 1
            continue

        lat, lng = utm10n_to_latlng(x, y)
        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
            stats["skipped: outside Vancouver"] += 1
            continue

        if vpd_type not in type_index:
            type_index[vpd_type] = len(types)
            types.append(vpd_type)
        hour = to_int(row.get("HOUR"))
        hour = hour if hour is not None and 0 <= hour <= 23 else -1

        points.append([round(lat, 5), round(lng, 5), type_index[vpd_type], hour, period])
        stats["kept: shown on the map" if period == 0 else "kept: previous 12 months (comparison)"] += 1

        if period == 0:
            last_counts_by_type[vpd_type] += 1
            hood = (row.get("NEIGHBOURHOOD") or "").strip()
            if hood:
                s = hood_sums[hood]
                s[0] += lat
                s[1] += lng
                s[2] += 1

    neighbourhoods = sorted(
        ({"name": name, "lat": round(s[0] / s[2], 5), "lng": round(s[1] / s[2], 5)} for name, s in hood_sums.items()),
        key=lambda h: h["name"],
    )

    data = {
        "source": "Vancouver Police Department, GeoDASH Open Data (https://geodash.vpd.ca/opendata/)",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "latestDate": latest.isoformat(),
        "shownStart": shown_start.isoformat(),
        "periodLabel": period_label,
        "compare": compare,
        "noLocation": stats["no location, in the shown period"],
        "types": [
            {"label": TYPE_LABELS.get(t, t), "vpd": t, "blurred": t in BLURRED_TYPES} for t in types
        ],
        "neighbourhoods": neighbourhoods,
        # Each point: [lat, lng, type index, hour (-1 if unknown), period (0 = shown on map, 1 = comparison)]
        "points": points,
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    # Summary: use these numbers to check the app shows the same totals.
    print(f"\nData runs through {latest.isoformat()}")
    print(f"Shown on the map: {data['shownStart']} to {latest.isoformat()}\n")
    for key in sorted(stats):
        print(f"  {key:<40} {stats[key]:>9,}")
    print(f"\nIncidents on the map {period_label}, by type:")
    for t, n in last_counts_by_type.most_common():
        print(f"  {TYPE_LABELS.get(t, t):<40} {n:>9,}")
    size_mb = out.stat().st_size / 1_000_000
    print(f"\nWrote {out} ({size_mb:.1f} MB, {len(points):,} points)")


if __name__ == "__main__":
    main()
