#!/usr/bin/env python3
"""One-time, bounded, READ-ONLY SuperBand OTA catalog check for BG02.

Uses the existing app-derived probe script to fetch *catalog metadata* only.
No badge/BLE connection, OTA initiation, upload or file download.

Version inputs come from previously confirmed LJ733 catalog rows and their
returned target versions, plus the live BG02 V35922 version. This is not a
numeric-version sweep. Do NOT enlarge the list by guessing hundreds of values.

Never print the catalog's app token, unredacted response, or query URL.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
KNOWN_LOOKUP = [
    "V35922",  # live BG02, previous documented response: no offered update
    "V34574",  # LJ733B/HYX target from V34250, not BG02
    "V34576",  # LJ733B/HYX target from V32449, not BG02
    "V34250",  # known LJ733B/HYX predecessor
    "V32449",  # known LJ733B/HYX predecessor
    "V32294",  # known DG01 predecessor
    "V32172",  # known BJ-1 predecessor
    "V27423",  # known old generic LJ733 predecessor
]
MATCH_BOARD = re.compile(r"(?:^|[_/\\-])(?:BG02|LJ733_MB_V1[.]5)(?:[_/\\.-]|$)", re.I)
MATCH_TARGET = re.compile(r"(?<![0-9])V35922(?![0-9])", re.I)


def classify_download(url: str) -> str:
    """Conservative filename classification; an OTA URL alone never proves compatibility."""
    if not url:
        return "no-download"
    # The URL alone cannot distinguish a correct board if branding is absent.
    if MATCH_BOARD.search(url) and MATCH_TARGET.search(url):
        return "possible-bg02-v35922-needs-ufw-header-review"
    if MATCH_TARGET.search(url):
        return "target-v35922-board-identity-unverified"
    return "other-target-not-proven-bg02-compatible"


def check(version: str) -> dict:
    assert version in KNOWN_LOOKUP
    try:
        cp = subprocess.run(
            ["bun", "tools/probe-ota.mjs", "--name", "BG02", "--version", version],
            cwd=ROOT, capture_output=True, text=True, timeout=18, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as ex:
        return {"from": version, "status": "indeterminate", "error": type(ex).__name__}
    try:
        obj = json.loads(cp.stdout)
        if not isinstance(obj, dict):
            raise ValueError("not dict")
        body = obj.get("body") or {}
        if not isinstance(body, dict):
            raise ValueError("non-object body")
        data = body.get("data")
        http_status = obj.get("status")
    except (ValueError, TypeError, json.JSONDecodeError):
        return {"from": version, "status": "indeterminate", "error": "unparseable-json"}
    if http_status != 200:
        return {"from": version, "status": "indeterminate", "http_status": http_status}
    if not isinstance(data, dict):
        return {"from": version, "status": "no-offer"}
    url = data.get("app_down_url") or data.get("appDownUrl4g")
    if not url:
        return {"from": version, "status": "no-download-url"}
    if not isinstance(url, str):
        return {"from": version, "status": "indeterminate", "error": "non-string-download-url"}
    name = data.get("name")
    target = url.split("?")[0].rsplit("/", 1)[-1][:160]
    # Public filename only, not a URL with possible private parameters.
    return {
        "from": version,
        "status": "upgrade-catalog-entry",
        "catalog_product": str(name)[:80] if name is not None else None,
        "target_filename": target,
        "candidate_classification": classify_download(url),
    }


def main() -> int:
    print("BG02 OFFLINE/READ-ONLY OTA CATALOG: NO BLE, NO DOWNLOAD, NO FLASH")
    print("Known predecessor/target versions only; not an exhaustive server archive.")
    for version in KNOWN_LOOKUP:
        print(json.dumps(check(version), sort_keys=True), flush=True)
    print("Even a BG02-named ZIP must be inspected for matching hardware and UFW geometry.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
