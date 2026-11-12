#!/usr/bin/env python3
"""Read-only component comparison of already-unpacked JieLi AC707N OTA images.

Input is directories produced by jl-misctools fwunpack_newfw.py. Output is
metadata and SHA-256 hashes only; never reassembles or modifies OTA images.

Equal hashes prove identical *extracted file bytes*. App overlap probes use
exact 1-KiB anchors, not semantic function similarity or flash compatibility.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

FILE_LIMIT = 18 * 1024 * 1024
TOTAL_LIMIT = 72 * 1024 * 1024
RESOURCE_WORDS = ("game", "ui", "res", "tone", "audio", "font", "style", "sty", "avi", "dial", "watch", "picture")
ANCHOR_RE = re.compile(rb"[\x20-\x7e]{6,100}")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def scan_image(label, root):
    root = Path(root)
    if not (root / "files" / "app.bin").is_file():
        raise ValueError(f"{label}: no files/app.bin, cannot compare")
    members = {}
    read_total = 0
    for container in ("top", "files"):
        folder = root / container
        if not folder.is_dir():
            raise ValueError(f"{label}: missing {container}/")
        for file in sorted(folder.rglob("*")):
            if not file.is_file() or file.is_symlink():
                continue
            rel = file.relative_to(root).as_posix()
            n = file.stat().st_size
            if n > FILE_LIMIT or read_total + n > TOTAL_LIMIT:
                raise ValueError(f"{label}: oversized unpacked artifact {rel}")
            data = file.read_bytes()
            read_total += len(data)
            members[rel] = {"bytes": len(data), "sha256": sha(data)}
    app = (root / "files" / "app.bin").read_bytes()
    strings = {
        s.decode("ascii", "replace").strip()
        for s in ANCHOR_RE.findall(app)
        if s and len(set(s)) > 3
    }
    interesting = sorted(
        s for s in strings
        if any(token in s.lower() for token in
               ("game_", "game/", "watch.sty", "jl.sty", "bgp_wa", "tone_en",
                "nor_ui", "res_nor", ".avi", ".wtg", "jpeg_", "lcd_",
                "cst816", "jlot", "ble_ota", "AC707N_".lower()))
    )
    resources = sorted(
        rel for rel in members
        if rel != "files/app.bin"
        and any(k in rel.lower() for k in RESOURCE_WORDS)
    )
    banners = sorted(s for s in strings if s.startswith("AC707N_"))[:6]
    return {
        "label": label,
        "member_count": len(members),
        "total_extracted_bytes": read_total,
        "members": members,
        "app": app,
        "strings": strings,
        "app_sha256": sha(app),
        "app_bytes": len(app),
        "sdk_banners": banners,
        "resource_member_candidates": resources[:70],
        "resource_member_count": len(resources),
        "app_resource_string_candidates": interesting[:100],
        "app_resource_string_count": len(interesting),
    }


def exact_anchor_share(a, b, block=1024, step=256):
    """Count non-overlapping full-block slices of A that also exist in B.

    This is a *lower-bound, location-shift-tolerant exact-match metric*.
    It is NOT a statement that remaining bytes are different in function.
    Ignore runs with very low byte diversity to avoid padding bias.
    """
    def high_information(chunk):
        return len(set(chunk)) > 16
    hashes = {
        sha(b[j:j+block])
        for j in range(0, max(0, len(b)-block+1), step)
        if high_information(b[j:j+block])
    }
    valid = matching = 0
    for j in range(0, max(0, len(a)-block+1), block):
        x = a[j:j+block]
        if not high_information(x):
            continue
        valid += 1
        matching += sha(x) in hashes
    return {
        "block_bytes": block, "candidate_stride_bytes": step,
        "high_information_blocks_in_a": valid,
        "exact_matches_from_a_somewhere_in_b": matching,
        "share_percent_of_a_blocks": round(100 * matching / valid, 2) if valid else None,
        "excludes_low_diversity_blocks": True,
    }


def compare(a, b):
    am, bm = a["members"], b["members"]
    common = sorted(set(am) & set(bm))
    identical = [p for p in common if am[p]["sha256"] == bm[p]["sha256"]]
    different = [p for p in common if am[p]["sha256"] != bm[p]["sha256"]]
    only_a = sorted(set(am) - set(bm))
    only_b = sorted(set(bm) - set(am))
    code_a, code_b = a["app"], b["app"]
    shared_strings = (a["strings"] & b["strings"])
    total_strings = a["strings"] | b["strings"]
    return {
        "a": a["label"], "b": b["label"],
        "same_path_identical_sha256": identical,
        "same_path_different_sha256": different,
        "only_in_a": only_a,
        "only_in_b": only_b,
        "same_app_sha256": a["app_sha256"] == b["app_sha256"],
        "app_exact_1kib_anchors_a_to_b": exact_anchor_share(code_a, code_b),
        "app_exact_1kib_anchors_b_to_a": exact_anchor_share(code_b, code_a),
        "printable_string_set": {
            "shared": len(shared_strings), "union": len(total_strings),
            "jaccard_percent": round(100 * len(shared_strings) / len(total_strings), 2)
            if total_strings else None,
            "not_code_similarity": True,
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image", nargs=2, metavar=("LABEL", "UNPACK_DIR"),
                    action="append", required=True)
    ap.add_argument("--json-out", type=Path, required=True)
    ns = ap.parse_args()
    if len(ns.image) < 2:
        ap.error("need at least two --image LABEL DIR arguments")
    images = [scan_image(*args) for args in ns.image]
    results = {"schema": "bg02.firmware-component-compare.v1",
               "disclaimer": "Equal SHA256 is identical bytes only. Not proof of cross-flash compatibility.",
               "images": [], "pairs": []}
    for image in images:
        results["images"].append({
            k: v for k, v in image.items() if k not in ("app", "strings")
        })
    for i, a in enumerate(images):
        for b in images[i+1:]:
            results["pairs"].append(compare(a, b))
    ns.json_out.parent.mkdir(parents=True, exist_ok=True)
    ns.json_out.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")
    print("BG02 COMPONENT COMPARISON: READ-ONLY, NO BLE, NO FLASH, NO ZIP PUBLISHING")
    for im in results["images"]:
        print(f"IMAGE {im['label']}: files={im['member_count']} app={im['app_bytes']} "
              f"app_sha256={im['app_sha256']} SDK={im['sdk_banners']}")
        print("  RESOURCE_MEMBER_NAMES", json.dumps(im["resource_member_candidates"][:32]))
        print("  APP_STRING_MARKERS", json.dumps(im["app_resource_string_candidates"][:25]))
    for p in results["pairs"]:
        print(f"PAIR {p['a']} vs {p['b']}")
        print("  EXACT_FILE_MATCHES", json.dumps(p["same_path_identical_sha256"]))
        print("  SAME_NAME_DIFFERENT_HASH", json.dumps(p["same_path_different_sha256"]))
        print("  A_ONLY", json.dumps(p["only_in_a"][:50]))
        print("  B_ONLY", json.dumps(p["only_in_b"][:50]))
        print("  APP_EXACT_1KIB_A_TO_B", json.dumps(p["app_exact_1kib_anchors_a_to_b"]))
        print("  APP_EXACT_1KIB_B_TO_A", json.dumps(p["app_exact_1kib_anchors_b_to_a"]))
        print("  APP_STRING_OVERLAP", json.dumps(p["printable_string_set"]))
    print("COMPLETED. All images are other OEM/board packages, NOT BG02 V35922.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
