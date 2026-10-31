#!/usr/bin/env python3
"""
Download the latest VPD crime data from GeoDASH and rebuild web/data.json.

This replaces the manual steps (download each year from geodash.vpd.ca/opendata,
unzip into data/raw/, run prepare_data.py). GitHub Actions runs it every Sunday
(.github/workflows/update-data.yml); you can also run it yourself:

    python scripts/update_data.py            # from the repository root
    python scripts/update_data.py --force    # accept a big drop in incidents (see below)

What it does:
  1. Downloads one ZIP per year, 2016 to this year, for all neighbourhoods. These are
     the same files the GeoDASH download button gives you; by using the data you agree
     to VPD's disclaimer (data/vpd/legal_disclaimer.txt).
  2. Runs prepare_data.py on the CSVs inside, into a temporary file.
  3. Replaces web/data.json only if the data itself changed, so the weekly job doesn't
     commit a new file just because the "generated" time moved.
  4. Refuses to replace it if the new data has far fewer incidents than the current
     file, which usually means a broken or partial download rather than real news,
     or if the new file has a shape the app can't read.

Only the Python standard library is needed.
"""

import argparse
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PREPARE = REPO_ROOT / "scripts" / "prepare_data.py"
OUT = REPO_ROOT / "web" / "data.json"

FIRST_YEAR = 2016   # the app's data starts here
URL = "https://geodash.vpd.ca/opendata/crimedata_download/AllNeighbourhoods_{year}/crimedata_csv_AllNeighbourhoods_{year}.zip"
USER_AGENT = "VanScene weekly data refresh (+https://github.com/YazidNasser/Datathon-Project)"
MAX_DROP = 0.05     # more than 5% fewer incidents than before is treated as a bad download


def download(year):
    """The year's ZIP as bytes, or None if VPD hasn't published that year (yet)."""
    request = urllib.request.Request(URL.format(year=year), headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            if attempt == 2:
                raise
        except urllib.error.URLError:
            if attempt == 2:
                raise
        time.sleep(10 * (attempt + 1))   # GeoDASH is occasionally slow; wait and try again


def extract_csvs(blob, year, folder):
    """Write the CSVs inside a year's ZIP into folder, under names we choose (never paths from the ZIP)."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        sys.exit(f"The {year} download isn't a valid ZIP file. GeoDASH may be down; try again later.")
    with archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if not names:
            sys.exit(f"The {year} download has no CSV in it.")
        paths = []
        for i, name in enumerate(names):
            path = folder / f"vpd_{year}_{i}.csv"
            path.write_bytes(archive.read(name))
            paths.append(path)
        return paths


def incidents(data):
    return len(data["points"]["type"])


def without_timestamp(data):
    return {key: value for key, value in data.items() if key != "generated"}


def big_drop(old, new):
    return incidents(new) < incidents(old) * (1 - MAX_DROP)


def shape_problem(data):
    """What in data.json would break web/app.js, or None if it looks right."""
    p = data["points"]
    n = incidents(data)
    if data["version"] != 3:
        return f"version is {data['version']}, the app reads version 3"
    if n == 0:
        return "no incidents on the map"
    if any(len(p[col]) != n for col in ("lat", "lng", "hour", "year", "md")):
        return "the point columns have different lengths"
    if min(p["type"]) < 0 or max(p["type"]) >= len(data["types"]):
        return "a point has an unknown crime type"
    if min(p["hour"]) < -1 or max(p["hour"]) > 23:
        return "a point has an hour outside -1 to 23"
    if not set(p["year"]) <= set(data["years"]):
        return "a point has a year missing from the years list"
    date.fromisoformat(data["latestDate"])
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="Replace data.json even if the new data has far fewer incidents")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)   # keep our lines in order with prepare_data.py's in the Actions log

    this_year = date.today().year
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        csvs = []
        for year in range(FIRST_YEAR, this_year + 1):
            blob = download(year)
            if blob is None:
                if year == this_year:
                    print(f"{year}: not published yet, skipped")   # early January, before VPD's first update
                    continue
                sys.exit(f"{year}: GeoDASH has no file for this year ({URL.format(year=year)}). Has the address changed?")
            csvs += extract_csvs(blob, year, folder)
            print(f"{year}: {len(blob) / 1_000_000:.1f} MB")

        new_path = folder / "data.json"
        subprocess.run(
            [sys.executable, str(PREPARE), *map(str, csvs), "--from-year", str(FIRST_YEAR), "--out", str(new_path)],
            check=True,
        )
        new = json.loads(new_path.read_text(encoding="utf-8"))
        old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None

        if old and without_timestamp(old) == without_timestamp(new):
            print(f"\nNo change: data.json already holds VPD data to {old['latestDate']}.")
            return
        if old and big_drop(old, new) and not args.force:
            sys.exit(
                f"\nNot updating: the new data has {incidents(new):,} incidents on the map against "
                f"{incidents(old):,} now. That's more than a {MAX_DROP:.0%} drop, which usually means a "
                "broken download. Check GeoDASH, then rerun with --force if the drop is real."
            )
        problem = shape_problem(new)
        if problem:
            sys.exit(f"\nNot updating: {problem}. web/data.json is unchanged.")
        shutil.copyfile(new_path, OUT)
        before = f"{old['latestDate']}, {incidents(old):,} incidents" if old else "no file"
        print(f"\nUpdated web/data.json: data to {new['latestDate']}, {incidents(new):,} incidents (was {before}).")


if __name__ == "__main__":
    main()
