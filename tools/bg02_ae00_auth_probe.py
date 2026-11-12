#!/usr/bin/env python3
"""Opt-in BG02 AE00 authentication + read-only target information diagnostic.

Default invocation is OFFLINE. A live session requires --connect and reuses the
MIT-licensed ElectronicCats qix_ble.AuthSession implementation as a dependency.

On the wire this program permits ONLY the three raw JieLi authentication writes
and (unless --auth-only) ONE authenticated RCSP target-info command (opcode 03).
It NEVER browses, transfers or deletes files, invokes OTA, flashes, or retries.

A successful related-chipset handshake is not proof BG02 wallpaper readback works.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
import queue
import sys
import time

AE00 = "0000ae00-0000-1000-8000-00805f9b34fb"
AE01 = "0000ae01-0000-1000-8000-00805f9b34fb"
AE02 = "0000ae02-0000-1000-8000-00805f9b34fb"
MAGIC = b"\xfe\xdc\xba"


class ProtocolGuardError(RuntimeError):
    pass


class ProbeStageError(RuntimeError):
    def __init__(self, stage: str, reason_type: str):
        super().__init__(stage)
        self.stage = stage
        self.reason_type = reason_type


def classify_allowed_write(data: bytes, authenticated: bool) -> str:
    """Strict application-payload allowlist. No OTA / FS / rawflash calls."""
    if not authenticated:
        if len(data) == 17 and data[0] in (0, 1):
            return "authentication-challenge-or-response"
        if data == b"\x02pass":
            return "authentication-accept"
        raise ProtocolGuardError("non-authenticated write not on allowlist")
    if len(data) != 14 or not data.startswith(MAGIC) or data[-1] != 0xEF:
        raise ProtocolGuardError("post-auth write is not target-info request")
    # flags C0; opcode 03; six-byte body [serial, 4B feature mask, platform]
    if data[3:7] != bytes.fromhex("c0 03 00 06"):
        raise ProtocolGuardError("only read-only target-info opcode 0x03 is allowed")
    if data[8:12] != b"\xff" * 4 or data[12] != 0:
        raise ProtocolGuardError("unexpected target-info parameters")
    return "target-info"


class Ae00AuthTransport:
    """Thread-safe adapter for the pure-Python JieLi auth and RCSP libraries."""

    def __init__(self, loop, client):
        self.loop = loop
        self.client = client
        self._auth_done = False
        self.rx = queue.Queue()
        self.rx_frames = bytearray()
        self.writes = Counter()

    def on_notify(self, _characteristic, payload):
        self.rx.put(bytes(payload))

    def send_to_ae01(self, data):
        payload = bytes(data)
        label = classify_allowed_write(payload, self._auth_done)
        # Called from the worker thread, NEVER from the asyncio event loop.
        task = asyncio.run_coroutine_threadsafe(
            self.client.write_gatt_char(AE01, payload, response=False), self.loop
        )
        task.result(timeout=8)
        self.writes[label] += 1

    def recv_ae02_raw(self, timeout=5.0):
        try:
            return self.rx.get(timeout=timeout)
        except queue.Empty as exc:
            raise TimeoutError("AE02 response not received within the bounded window") from exc

    def send_rcsp_frame(self, frame):
        if not self._auth_done:
            raise ProtocolGuardError("authenticated RCSP session required")
        self.send_to_ae01(frame.encode())

    def recv_rcsp_frame(self, timeout=8.0):
        from qix_ble.rcsp_frame import RcspFrame
        deadline = time.monotonic() + timeout
        while True:
            frame, remaining = RcspFrame.from_bytes_stream(self.rx_frames)
            self.rx_frames = remaining
            if frame is not None:
                return frame
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError("no complete RCSP response")
            self.rx_frames.extend(self.recv_ae02_raw(timeout=left))


def authenticated_read_only_session(transport, auth_only=False):
    """Executed in worker thread; qix_ble never controls BLE or device selection."""
    from qix_ble.auth import AuthSession
    from qix_ble.rcsp_session import RcspSession
    from qix_ble.sysinfo import get_target_info

    try:
        AuthSession(transport, step_timeout=5.0).do_handshake()
        if not transport._auth_done:
            raise ProtocolGuardError("library did not confirm authentication")
    except Exception as exc:
        raise ProbeStageError("authentication", type(exc).__name__) from None
    if auth_only:
        return {"authenticated": True, "target_info": "skipped"}
    try:
        info = get_target_info(RcspSession(transport), timeout=8.0)
    except Exception as exc:
        raise ProbeStageError("target_info", type(exc).__name__) from None
    # Do not emit raw attribute values: can contain MAC/serial/auth material.
    return {
        "authenticated": True,
        "target_info": "received",
        "attribute_names": sorted({a.name for a in info.attrs}),
        "attribute_count": len(info.attrs),
    }


async def run_live(device_name, auth_only):
    try:
        import qix_ble.auth  # noqa: F401
        from bleak import BleakClient, BleakScanner
    except ImportError as exc:
        print("Install 'bleak' and the MIT-licensed ElectronicCats 'qix-ble' library.", file=sys.stderr)
        print(f"Missing dependency: {exc.name}", file=sys.stderr)
        return 2

    dev = await BleakScanner.find_device_by_filter(
        lambda d, adv: (d.name or "").strip().casefold() == device_name.casefold()
        or (adv.local_name or "").strip().casefold() == device_name.casefold(),
        timeout=15.0,
    )
    if dev is None or (dev.name or "").strip().casefold() != "bg02":
        print("Exact BG02 advertising device not found; nothing sent.", file=sys.stderr)
        return 3

    async with BleakClient(dev, timeout=18.0) as client:
        service = client.services.get_service(AE00)
        write = service.get_characteristic(AE01) if service else None
        notify = service.get_characteristic(AE02) if service else None
        if not write or not notify or "write-without-response" not in write.properties:
            print("AE00 / AE01 / AE02 capabilities do not match; nothing sent.", file=sys.stderr)
            return 3

        transport = Ae00AuthTransport(asyncio.get_running_loop(), client)
        await client.start_notify(AE02, transport.on_notify)
        try:
            result = await asyncio.to_thread(authenticated_read_only_session, transport, auth_only)
        except Exception as exc:
            # Preserve stage/writes only. Avoid printing secrets from cipher errors.
            print(json.dumps({"status": "stopped",
                              "phase": getattr(exc, "stage", "unknown"),
                              "reason_type": getattr(exc, "reason_type", type(exc).__name__),
                              "writes": dict(transport.writes)}, indent=2))
            return 4
        print(json.dumps({"status": "ok", **result, "writes": dict(transport.writes)}, indent=2))
        print("This does not prove media or wallpaper browsing is available.")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--device", default="BG02", choices=["BG02"], help="Exact device name")
    p.add_argument("--connect", action="store_true", help="Explicitly enable a single live auth session")
    p.add_argument("--auth-only", action="store_true", help="Skip the post-auth read-only target-info query")
    args = p.parse_args(argv)
    if not args.connect:
        print("OFFLINE: no BLE actions. Optional --connect performs one guarded auth session.")
        print("Only authentication messages + read-only target-info opcode 0x03 are allowed.")
        return 0
    try:
        return asyncio.run(run_live(args.device, args.auth_only))
    except Exception as exc:
        print("Bluetooth setup failed:", type(exc).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
