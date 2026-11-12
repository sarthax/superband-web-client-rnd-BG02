#!/usr/bin/env python3
"""BG02 AE02 passive observer and offline RCSP frame inspector.

No application commands are sent. The old --probe-target-info switch is
RETIRED and fails before opening Bluetooth: opcode 0x02 was incorrectly
labelled as GET_TARGET_INFO; actual GET_TARGET_INFO is 0x03 and may require
a successful app-layer authentication before it can be queried.

From the repository root, on Windows:
  uv run --native-tls --with bleak python tools/bg02_rcsp_observe.py --device BG02 --seconds 8
  py -3 tools/bg02_rcsp_observe.py --inspect bg02_rcsp_observe.jsonl
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

from bg02_rcsp_protocol import FrameAssembler, describe_bytes

AE00 = "0000ae00-0000-1000-8000-00805f9b34fb"
AE02 = "0000ae02-0000-1000-8000-00805f9b34fb"
UART = "7e400001-b5a3-f393-e0a9-e50e24dcca9d"
UART_NOTIFY = "7e400003-b5a3-f393-e0a9-e50e24dcca9d"


def inspect(path: Path) -> int:
    """Offline JSONL inspection only. No Bluetooth operations."""
    if not path.is_file():
        print(f"Input does not exist: {path}", file=sys.stderr)
        return 2
    counts: Counter[str] = Counter()
    assembler = FrameAssembler()
    decoded = 0
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                raw = bytes.fromhex(entry["hex"])
                channel = entry["stream"]
            except (ValueError, KeyError, TypeError) as exc:
                print(f"Invalid JSONL entry at {line_number}: {exc}", file=sys.stderr)
                return 2
            counts[channel] += 1
            if channel != "ae02":
                continue
            for packet in assembler.feed(raw):
                decoded += 1
                print(f"RX frame line {line_number}: opcode={packet['opcode']} {packet['opcode_name']} "
                      f"flags={packet['flags']} body={packet['body_length']}B "
                      f"status={packet.get('possible_status','n/a')}")
    print(f"Events: {sum(counts.values())}, decoded AE02 RCSP frames: {decoded}, streams: {dict(counts)}")
    if not decoded:
        print("No complete RCSP response parsed. Not proof that RCSP or readback is unsupported.")
    return 0


async def locate(target: str):
    from bleak import BleakScanner
    if re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", target):
        return await BleakScanner.find_device_by_address(target, timeout=20.0)
    needle = target.casefold()
    return await BleakScanner.find_device_by_filter(
        lambda dev, adv: needle in (dev.name or "").casefold()
        or needle in (adv.local_name or "").casefold(), timeout=20.0
    )


async def observe(target: str, seconds: float, path: Path, also_uart: bool) -> int:
    try:
        from bleak import BleakClient
    except ImportError:
        print("Bleak is not installed (use uv run --with bleak).", file=sys.stderr)
        return 2
    print("Discovering BG02...")
    dev = await locate(target)
    if dev is None:
        print(f"Device {target!r} was not discovered.", file=sys.stderr)
        return 2
    path.parent.mkdir(parents=True, exist_ok=True)
    counter: Counter[str] = Counter()
    decoders = {"ae02": FrameAssembler()}
    start = time.monotonic()
    with path.open("w", encoding="utf-8") as log:
        async with BleakClient(dev, timeout=20.0) as client:
            uuids = {service.uuid.lower() for service in client.services}
            if AE00 not in uuids:
                print("AE00 service absent. No RCSP probe performed.")
                return 3

            def write_event(channel: str, raw: bytes, direction: str):
                info = describe_bytes(raw)
                event = {"elapsed_ms": round((time.monotonic()-start)*1000),
                         "stream": channel, "direction": direction, **info}
                log.write(json.dumps(event, sort_keys=True) + "\n")
                log.flush()
                counter[channel] += 1
                return event

            def capture(channel: str):
                def handler(_characteristic, chunk: bytearray):
                    data = bytes(chunk)
                    event = write_event(channel, data, "rx")
                    decoded = decoders.get(channel)
                    frames = decoded.feed(data) if decoded else []
                    print(f"[{event['elapsed_ms']} ms] {channel}: {len(data)} bytes")
                    for frame in frames:
                        print(f"  RCSP {frame['opcode']} {frame['opcode_name']} "
                              f"flags={frame['flags']} status={frame.get('possible_status', 'n/a')}")
                return handler

            await client.start_notify(AE02, capture("ae02"))
            if also_uart and UART in uuids:
                try:
                    await client.start_notify(UART_NOTIFY, capture("7e400003"))
                except Exception as exc:
                    print(f"Optional UART notification subscription failed: {exc}")
            print("Passive observation only; no application commands sent.")
            await asyncio.sleep(seconds)
    print(f"Saved {sum(counter.values())} event(s) to {path} (AE02 RX: {counter['ae02']}).")
    if not counter["ae02"]:
        print("No AE02 response. Authentication/unsupported firmware unresolved; do not retry automatically.")
    print("Do not publish raw payload logs without reviewing sensitive data.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", default="BG02", help="Bluetooth name or address (BG02 only for active query)")
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--output", type=Path, default=Path("bg02_rcsp_observe.jsonl"))
    ap.add_argument("--also-uart", action="store_true", help="Add FitPro UART notification; no commands")
    ap.add_argument("--probe-target-info", action="store_true", help="RETIRED: unsafe without verified BG02 authentication; immediately refuses")
    ap.add_argument("--inspect", type=Path, help="Offline inspect saved JSONL (no BLE)")
    args = ap.parse_args()
    if args.inspect:
        return inspect(args.inspect)
    if args.probe_target_info:
        print("Target-info probe retired: the former 0x02 command was misidentified; "
              "the real 0x03 request may require authentication. No BLE connection "
              "or application write was made.", file=sys.stderr)
        return 4
    if not 1 <= args.seconds <= 120:
        ap.error("--seconds must be 1–120 seconds")
    try:
        return asyncio.run(observe(args.device, args.seconds, args.output, args.also_uart))
    except (OSError, RuntimeError, TimeoutError) as exc:
        print(f"Diagnostic failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
