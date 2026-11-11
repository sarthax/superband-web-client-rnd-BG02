#!/usr/bin/env python3
"""Offline LJ733 firmware evidence scanner (standard-library Python, Windows friendly).

Safely indexes bytes *available* in firmware ZIPs, UFWs, extracted app.bin,
and directories. It NEVER connects to Bluetooth, flashes, or modifies inputs.

Run from repo root:
  py -3 tools/bg02_firmware_evidence.py research/firmware/lj733_V27550.zip research/firmware/lj733b_V34574.zip --json-out evidence.json
  py -3 tools/bg02_firmware_evidence.py research/firmware/analysis --json-out unpacked.json

IMPORTANT: a JieLi app.ufw may be a compressed/packed container. A missing
plaintext string in UFW says nothing about the firmware's implemented APIs.
Use jl-misctools to unpack app.ufw into app.bin for a stronger string scan.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

# This is a text-anchor triage, NOT instruction disassembly or RCSP support proof.
ANCHORS = {
    "wallpaper_sharing": [
        ("wallpaper_adv", b"wallpaper_adv"),
        ("sharing_entry", b"wallpaper_sharing"),
        ("sharing_api", b"jl_wallpaper_sharing"),
        ("sharing_flag", b"TCFG_JL_WALLPAPER"),
    ],
    "wallpaper_storage": [
        ("avi_wallpaper", b"bgp_wa"),
        ("watch_style", b"watch.sty"),
        ("wallpaper_cfg", b"wp_cfg.bin"),
        ("wallpaper_vfat", b"storage/virfat_flash"),
    ],
    "rcsp_filesystem": [
        ("rcsp_filebrowse", b"file_browse"),
        ("rcsp_get_file", b"get_file_by_"),
        ("rcsp_file_transfer", b"file_transfer"),
        ("rcsp_fs_cmd", b"rcsp_fs"),
    ],
    "auth": [
        ("rcsp_auth", b"rcsp_auth"),
        ("auth_api", b"jl_auth"),
        ("auth_native", b"getEncryptedAuthData"),
        ("auth_impl", b"auth_key"),
    ],
    "known_transport": [
        ("jieli_ota", b"JLOTA"),
        ("ble_ota", b"ble_ota"),
        ("jieli_chip", b"AC707N"),
        ("fitpro_image", b"res_nor_dial"),
    ],
}
MAX_BLOB = 24 * 1024 * 1024
MAX_TOTAL = 72 * 1024 * 1024
MAX_FILES = 2000
ARCHIVE_SUFFIX = {".zip"}
SCAN_SUFFIX = {".bin", ".ufw", ".dat", ".ini", ".json", ".txt", ".xml", ".c", ".h", ".md", ".so", ".elf"}


def _ascii_spans(data: bytes):
    """Yield printable string positions; offsets are relative to *this blob*."""
    for match in re.finditer(rb"[\x20-\x7e]{4,}", data):
        yield match.start(), match.group().decode("ascii", "replace"), "ascii"
    # ASCII letters inside UTF-16LE strings (often found in APK resources).
    for match in re.finditer(rb"(?:[\x20-\x7e]\x00){4,}", data):
        yield match.start(), match.group()[::2].decode("ascii", "replace"), "utf16le"


def classify(data: bytes, label: str) -> dict:
    """Plaintext hints: limited output, case-insensitive, no binary offsets guessed."""
    found: dict[str, list[dict]] = {name: [] for name in ANCHORS}
    needles = [(family, name, token.decode("ascii").casefold())
               for family, records in ANCHORS.items() for name, token in records]
    strings = list(_ascii_spans(data))
    for offset, value, encoding in strings:
        lowered = value.casefold()
        for family, name, needle in needles:
            if needle in lowered and len(found[family]) < 20:
                found[family].append({
                    "anchor": name,
                    "offset_in_member": offset,
                    "encoding": encoding,
                    "excerpt": value[:130],
                })
    hits = {k: v for k, v in found.items() if v}
    return {
        "member": label,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "kind": Path(label).suffix.lower().lstrip(".") or "unknown",
        "hits": hits,
        "anchor_families": list(hits),
        "capability_verdict": "UNVERIFIED_BY_TEXT_SCAN",
        "packed_container_warning": label.lower().endswith(".ufw"),
    }


def _read_file(path: Path, member: str | None = None) -> bytes | None:
    try:
        if path.stat().st_size > MAX_BLOB:
            return None
        return path.read_bytes()
    except OSError:
        return None


def scan_source(path: Path) -> dict:
    """Scan one input path; zip members are examined but not extracted to disk."""
    result = {"input": str(path), "entries": [], "skipped": [], "notes": []}
    if not path.exists():
        result["notes"].append("Input does not exist")
        return result

    paths = sorted((p for p in path.rglob("*") if p.is_file()), key=str) if path.is_dir() else [path]
    total_bytes = 0
    visited = 0
    for item in paths:
        if visited >= MAX_FILES or total_bytes >= MAX_TOTAL:
            result["notes"].append("Scan budget reached; not all files inspected")
            break
        if item.is_dir():
            continue
        visited += 1
        if item.suffix.lower() in ARCHIVE_SUFFIX:
            try:
                with zipfile.ZipFile(item) as zf:
                    for entry in sorted(zf.infolist(), key=lambda x: x.filename):
                        if entry.is_dir():
                            continue
                        if total_bytes >= MAX_TOTAL or len(result["entries"]) >= MAX_FILES:
                            result["notes"].append("Archive scan budget reached")
                            break
                        if entry.file_size > MAX_BLOB:
                            result["skipped"].append({"member": entry.filename, "reason": "member too large"})
                            continue
                        if Path(entry.filename).suffix.lower() not in SCAN_SUFFIX:
                            continue
                        try:
                            data = zf.read(entry)
                        except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
                            result["skipped"].append({"member": entry.filename, "reason": type(exc).__name__})
                            continue
                        total_bytes += len(data)
                        result["entries"].append(classify(data, f"{item.name}!{entry.filename}"))
            except (OSError, zipfile.BadZipFile) as exc:
                result["skipped"].append({"member": str(item), "reason": type(exc).__name__})
        elif item.suffix.lower() in SCAN_SUFFIX:
            data = _read_file(item)
            if data is None:
                result["skipped"].append({"member": str(item), "reason": "unreadable or over size limit"})
                continue
            total_bytes += len(data)
            result["entries"].append(classify(data, str(item.relative_to(path) if path.is_dir() else item.name)))
    if not result["entries"]:
        result["notes"].append("No readable supported members: cannot infer firmware capability")
    if any(x["packed_container_warning"] for x in result["entries"]):
        result["notes"].append("UFW scanned as opaque bytes; unpack app.bin before drawing negative conclusions")
    result["notes"].append("String anchors are hints only: no validated handler, authentication, or readback established")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", type=Path, help="ZIP, UFW, app.bin, or unpacked directories")
    parser.add_argument("--json-out", type=Path, help="optional UTF-8 JSON report")
    args = parser.parse_args(argv)
    reports = [scan_source(p) for p in args.inputs]
    output = {"schema": "bg02.firmware-evidence.v1", "sources": reports,
              "scope": "OFFLINE-TEXT-ANCHORS-ONLY",
              "disclaimer": "No negative inference from packed UFW or from missing strings"}
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {args.json_out}")
    for report in reports:
        print(f"\n{report['input']}: {len(report['entries'])} inspected member(s)")
        for entry in report["entries"]:
            counts = {family: len(v) for family, v in entry["hits"].items()}
            print(f"  {entry['member']}: {entry['bytes']:,} bytes, anchor families={counts or 'none'}")
            if entry["packed_container_warning"]:
                print("    Packed UFW: no negative conclusions from missing plaintext")
        for note in report["notes"]:
            print(f"  NOTE: {note}")
        for skip in report["skipped"][:8]:
            print(f"  SKIP: {skip['member']} ({skip['reason']})")
    return 0 if all(p.exists() for p in args.inputs) else 2


if __name__ == "__main__":
    raise SystemExit(main())
