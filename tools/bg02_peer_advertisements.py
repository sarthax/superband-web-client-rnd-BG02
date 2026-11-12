#!/usr/bin/env python3
"""Compare BG02 BLE advertisements in normal mode versus Receive Picture mode.

One passive, Windows-friendly Bleak scanner session. NO GATT connection, no
notification subscriptions, no app commands, no firmware or image writes.

Default captures anonymized peer IDs, advertised names, service UUIDs and
payload hashes/lengths only. It does not save MAC addresses or raw BLE payloads.

  uv run --native-tls --with bleak python tools/bg02_peer_advertisements.py --output "D:\Claude\scratch\bg02_peer_adv.json"
  py -3 tools/bg02_peer_advertisements.py --inspect "D:\Claude\scratch\bg02_peer_adv.json"

Start with BG02 on its normal screen. When prompted after the baseline scan,
switch the badge to Receive Picture and press Enter. Do not connect from the
phone's SuperBand app or the browser during the test.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import time

SCHEMA = "bg02.peer-advertisements.v1"
MAX_DEVICES = 350
MAX_VARIANTS = 12
INTEREST = ("bg02", "wallpaper", "lj733", "badge", "superband")


def _short_hash(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8", "replace")
    return hashlib.sha256(data).hexdigest()[:16]


def _payloads(values: dict) -> list[dict]:
    return [
        {"key": str(k).lower(), "len": len(bytes(v)), "sha256_prefix": _short_hash(bytes(v))}
        for k, v in sorted(values.items(), key=lambda kv: str(kv[0]).lower())
    ]


def advertisement_signature(device_name: str | None, adv) -> dict:
    """BLE packet contents useful for compare, without raw payload or addresses."""
    return {
        "local_name": adv.local_name or "",
        "cached_device_name": device_name or "",
        "service_uuids": sorted((x.lower() for x in (adv.service_uuids or []))),
        "manufacturer": _payloads(adv.manufacturer_data or {}),
        "service_data": _payloads(adv.service_data or {}),
    }


def _signature_key(sig: dict) -> str:
    # Ignore cached device names for signature changes: Windows may cache them.
    effective = {k: v for k, v in sig.items() if k != "cached_device_name"}
    return _short_hash(json.dumps(effective, sort_keys=True, ensure_ascii=False))


class PhaseRecorder:
    def __init__(self, phase: str):
        self.phase = phase
        self.started = time.monotonic()
        self.devices: dict[str, dict] = {}
        self.dropped = 0
        self.events = 0

    def record(self, device, adv) -> None:
        self.events += 1
        # Hash addresses to permit within-session comparison without publishing them.
        address = str(getattr(device, "address", "") or "")
        if not address:
            return
        pid = _short_hash(address.casefold())
        if pid not in self.devices and len(self.devices) >= MAX_DEVICES:
            self.dropped += 1
            return
        entry = self.devices.setdefault(
            pid, {"id": pid, "count": 0, "rssi_max": -999,
                  "variants": [], "first_ms": round((time.monotonic()-self.started)*1000)}
        )
        entry["count"] += 1
        rssi = getattr(adv, "rssi", None)
        if isinstance(rssi, (int, float)):
            entry["rssi_max"] = max(entry["rssi_max"], int(rssi))
        sig = advertisement_signature(getattr(device, "name", None), adv)
        sig["signature"] = _signature_key(sig)
        if all(v["signature"] != sig["signature"] for v in entry["variants"]):
            if len(entry["variants"]) < MAX_VARIANTS:
                entry["variants"].append(sig)

    def result(self) -> dict:
        return {
            "phase": self.phase,
            "events": self.events,
            "dropped_new_devices": self.dropped,
            "devices": sorted(self.devices.values(), key=lambda x: x["id"]),
        }


def _display_name(device: dict) -> str:
    variants = device.get("variants", [])
    names = [v.get("local_name") or v.get("cached_device_name") for v in variants]
    return next((n for n in names if n), "(unnamed)")


def compare(baseline: dict, receiver: dict) -> dict:
    left = {d["id"]: d for d in baseline.get("devices", [])}
    right = {d["id"]: d for d in receiver.get("devices", [])}
    new = [right[k] for k in sorted(right.keys() - left.keys())]
    gone = [left[k] for k in sorted(left.keys() - right.keys())]
    changed = []
    for pid in sorted(left.keys() & right.keys()):
        a = {v["signature"] for v in left[pid].get("variants", [])}
        b = {v["signature"] for v in right[pid].get("variants", [])}
        if a != b:
            changed.append(right[pid])
    interesting = lambda d: any(word in _display_name(d).lower() for word in INTEREST)
    return {
        "baseline_devices": len(left),
        "receive_devices": len(right),
        "new_count": len(new),
        "changed_count": len(changed),
        "missing_count": len(gone),
        "new_named_candidates": [_summary(x) for x in new if interesting(x)][:25],
        "changed_named_candidates": [_summary(x) for x in changed if interesting(x)][:25],
        # New/changed unnamed advertisers can be a sharing receiver, but are noisy.
        "other_new_advertisers": [_summary(x) for x in new if not interesting(x)][:20],
        "interpretation": (
            "Advertisement differences are candidates, not proof of BG02 protocol. "
            "No difference or no advertisements does not rule out a scanner-only role."
        ),
    }


def _summary(device: dict) -> dict:
    return {
        "id": device["id"],
        "name": _display_name(device),
        "count": device.get("count", 0),
        "rssi_max": device.get("rssi_max"),
        "signatures": [
            {"name": v.get("local_name") or v.get("cached_device_name") or "",
             "service_uuids": v.get("service_uuids", []),
             "manufacturer_ids": [x["key"] for x in v.get("manufacturer", [])],
             "signature": v["signature"]}
            for v in device.get("variants", [])[:5]
        ],
    }


def summarize(saved: dict) -> dict:
    phases = saved.get("phases", [])
    if saved.get("schema") != SCHEMA or len(phases) != 2:
        raise ValueError("Expected two-phase BG02 advertisement capture")
    if [p.get("phase") for p in phases] != ["normal", "receive"]:
        raise ValueError("Unexpected phase names/order")
    return compare(phases[0], phases[1])


async def _scan(phase: str, seconds: int) -> dict:
    from bleak import BleakScanner
    recorder = PhaseRecorder(phase)
    scanner = BleakScanner(detection_callback=recorder.record)
    print(f"Scanning Bluetooth advertisements ({phase}, {seconds}s); no connections...", flush=True)
    async with scanner:
        await asyncio.sleep(seconds)
    return recorder.result()


async def capture(normal_secs: int, receive_secs: int, out: Path) -> int:
    print("Close SuperBand and browser BLE connections. Set BG02 to its NORMAL display.")
    await asyncio.to_thread(input, "Press Enter to begin the baseline scan: ")
    normal = await _scan("normal", normal_secs)
    print(f"Normal: {len(normal['devices'])} distinct advertisers; {normal['events']} events.")
    await asyncio.to_thread(input, "Now open BG02 'Receive Picture', then press Enter: ")
    receive = await _scan("receive", receive_secs)
    saved = {
        "schema": SCHEMA,
        "capture_type": "passive_advertisements_only",
        "identity": "SHA256-prefix of device address; no raw addresses/payloads",
        "phases": [normal, receive],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(saved, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved anonymized capture to {out}")
    print(json.dumps(summarize(saved), indent=2, ensure_ascii=False))
    print("If there are candidate changes, share this summary first, not the raw file.")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--output", type=Path, default=Path("bg02_peer_adv.json"))
    p.add_argument("--normal-seconds", type=int, default=12)
    p.add_argument("--receive-seconds", type=int, default=15)
    p.add_argument("--inspect", type=Path, help="Offline summary of an existing capture")
    args = p.parse_args(argv)
    if args.inspect:
        try:
            print(json.dumps(summarize(json.loads(args.inspect.read_text(encoding="utf-8"))),
                             indent=2, ensure_ascii=False))
            return 0
        except (OSError, ValueError, KeyError) as exc:
            print(f"Invalid capture: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 2
    if not (3 <= args.normal_seconds <= 60 and 3 <= args.receive_seconds <= 60):
        p.error("Each capture window must be 3 to 60 seconds")
    try:
        return asyncio.run(capture(args.normal_seconds, args.receive_seconds, args.output))
    except (OSError, RuntimeError, KeyboardInterrupt, EOFError, ImportError) as exc:
        print(f"Capture stopped: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
