#!/usr/bin/env python3
"""Passive BG02 AE02 notification observer.

Subscribes to JieLi's AE02 notification characteristic, without sending RCSP,
FitPro, file-management, or OTA commands. A GATT notification subscription
does write the *standard CCCD descriptor*. No application commands are sent.

Examples (from the repository root, with Windows Bluetooth):
  uv run --with bleak python tools/bg02_rcsp_observe.py --device BG02 --seconds 20
  uv run --with bleak python tools/bg02_rcsp_observe.py --device BG02 --seconds 20 --also-uart
  python tools/bg02_rcsp_observe.py --inspect bg02_rcsp_observe.jsonl

A lack of notifications is NOT evidence that RCSP or file readback is absent.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path
import re
import sys
import time

AE00 = "0000ae00-0000-1000-8000-00805f9b34fb"
AE02 = "0000ae02-0000-1000-8000-00805f9b34fb"
UART = "7e400001-b5a3-f393-e0a9-e50e24dcca9d"
UART_NOTIFY = "7e400003-b5a3-f393-e0a9-e50e24dcca9d"
RCSP_MAGIC = bytes.fromhex("fe dc ba")
# These are published JieLi RCSP opcodes, not a BG02-specific capability map.
RCSP_LABELS = {
    0x02: "GET_TARGET_FEATURE_MAP",
    0x03: "GET_TARGET_FEATURE",
    0x07: "SYS_INFO_GET",
    0x09: "SYS_INFO_AUTO_UPDATE",
    0x0C: "FILE_BROWSE_REQUEST_START",
    0x24: "ONE_FILE_TRANS_BACK",
}


def describe_bytes(data: bytes) -> dict:
    """Conservative fingerprint. Does not claim a complete RCSP frame."""
    out = {"size": len(data), "hex": data.hex()}
    # First notification may be only part of a vendor packet.
    position = data.find(RCSP_MAGIC)
    if position >= 0:
        out["rcsp_magic_offset"] = position
        start = position + len(RCSP_MAGIC)
        if len(data) >= start + 2:
            # JieLi defines a 16-bit packed header; low 8 bits are OpCode
            # in the documented little-endian variant.
            op = data[start]
            out["possible_rcsp_opcode"] = f"0x{op:02x}"
            if op in RCSP_LABELS:
                out["possible_opcode_name"] = RCSP_LABELS[op]
    if data.startswith(b"\xcd"):
        out["possible_fitpro_frame"] = True
    return out


def inspect(path: Path) -> int:
    if not path.is_file():
        print(f"Input does not exist: {path}", file=sys.stderr)
        return 2
    types: Counter[str] = Counter()
    magic = 0
    total_bytes = 0
    count = 0
    with path.open(encoding="utf-8") as f:
        for line_number, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                raw = bytes.fromhex(entry["hex"])
                stream = entry["stream"]
            except (ValueError, KeyError, TypeError) as e:
                print(f"Bad JSONL entry at line {line_number}: {e}", file=sys.stderr)
                return 2
            fingerprint = describe_bytes(raw)
            types[stream] += 1
            total_bytes += len(raw)
            count += 1
            if "rcsp_magic_offset" in fingerprint:
                magic += 1
                print(f"Possible RCSP fragment at line {line_number}: {fingerprint.get('possible_rcsp_opcode','partial')}")
    print(f"Packets: {count}; bytes: {total_bytes}; magic hits: {magic}; by stream: {dict(types)}")
    if not count:
        print("No notifications. This neither confirms nor rejects file-read capability.")
    return 0


async def locate(target: str):
    try:
        from bleak import BleakScanner
    except ImportError:
        raise RuntimeError("Bleak missing; use 'uv run --with bleak python ...'") from None
    if re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", target):
        return await BleakScanner.find_device_by_address(target, timeout=20.0)
    name = target.casefold()
    return await BleakScanner.find_device_by_filter(
        lambda dev, adv: name in (dev.name or "").casefold()
        or name in (adv.local_name or "").casefold(),
        timeout=20.0,
    )


async def observe(target: str, duration: float, path: Path, also_uart: bool) -> int:
    try:
        from bleak import BleakClient
    except ImportError:
        print("Bleak missing. Run using 'uv run --with bleak python ...'.", file=sys.stderr)
        return 2
    print("Finding device and connecting for notification subscription only...")
    device = await locate(target)
    if device is None:
        print("Device not found. Disconnect SuperBand/web manager and retry once.", file=sys.stderr)
        return 2

    path.parent.mkdir(parents=True, exist_ok=True)
    counts: Counter[str] = Counter()
    started = time.monotonic()
    with path.open("w", encoding="utf-8") as out:
        async with BleakClient(device, timeout=20) as client:
            services = client.services
            uuids = {svc.uuid.lower() for svc in services}
            if AE00 not in uuids:
                print("The AE00 service is absent on this connection. No RCSP capability proven.")
                return 3

            def capture(stream: str):
                def on_data(_characteristic, value: bytearray) -> None:
                    raw = bytes(value)
                    info = describe_bytes(raw)
                    entry = {"elapsed_ms": round((time.monotonic() - started) * 1000),
                             "stream": stream, **info}
                    out.write(json.dumps(entry, sort_keys=True) + "\n")
                    out.flush()
                    counts[stream] += 1
                    note = f" {info['possible_rcsp_opcode']}" if "possible_rcsp_opcode" in info else ""
                    print(f"[{entry['elapsed_ms']}ms] {stream}: {len(raw)} bytes{note}")
                return on_data

            # Subscribe only; no RCSP command or AE01/7E400002 application write.
            try:
                await client.start_notify(AE02, capture("ae02"))
            except Exception as err:
                print(f"AE02 notify subscription failed: {err}", file=sys.stderr)
                return 3
            if also_uart and UART in uuids:
                try:
                    await client.start_notify(UART_NOTIFY, capture("7e400003"))
                except Exception as err:
                    print(f"Optional UART subscribe failed: {err}", file=sys.stderr)
            print(f"Listening for {duration:g}s. You may navigate the BG02 sharing menu once.")
            await asyncio.sleep(duration)
    print(f"Saved {sum(counts.values())} raw notification fragments to {path}")
    if not counts:
        print("No notifications were emitted. That is inconclusive; do not infer readback support.")
    else:
        print("These are passive events, not proof of RCSP file browsing or a download.")
    print("The JSONL may contain private Bluetooth payloads. Don't publish without review.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", default="BG02", help="BLE name or address; default BG02")
    ap.add_argument("--seconds", type=float, default=20.0, help="Observation duration 1–120 seconds")
    ap.add_argument("--output", type=Path, default=Path("bg02_rcsp_observe.jsonl"))
    ap.add_argument("--also-uart", action="store_true", help="Also subscribe to 7E400003; no app writes")
    ap.add_argument("--inspect", type=Path, metavar="JSONL", help="Analyze saved events offline only; no BLE")
    args = ap.parse_args()
    if args.inspect:
        return inspect(args.inspect)
    if not 1 <= args.seconds <= 120:
        ap.error("--seconds must be between 1 and 120")
    try:
        return asyncio.run(observe(args.device, args.seconds, args.output, args.also_uart))
    except (OSError, RuntimeError, TimeoutError) as err:
        print(f"Observation failed: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
