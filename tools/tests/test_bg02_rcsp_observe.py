"""Offline-only checks for JieLi RCSP framing and the read-only identity diagnostic."""
from __future__ import annotations

import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from bg02_rcsp_protocol import (  # noqa: E402
    FrameAssembler, TARGET_INFO_REQUEST, describe_bytes, parse_frame,
)
from bg02_rcsp_observe import inspect  # noqa: E402


class RcspFramingTests(unittest.TestCase):
    def test_target_info_request_is_exact_known_read_only_frame(self):
        self.assertEqual(TARGET_INFO_REQUEST.hex(), "fedcbac003000601ffffffff00ef")
        result = parse_frame(TARGET_INFO_REQUEST)
        self.assertIsNotNone(result)
        self.assertEqual(result["opcode"], "0x03")
        self.assertEqual(result["flags"], "0xc0")
        self.assertEqual(result["body_length"], 6)
        self.assertEqual(result["possible_serial"], 1)

    def test_previous_off_by_one_opcode_bug_is_fixed(self):
        pkt = bytes.fromhex("fe dc ba 00 0c 00 02 00 01 ef")
        result = describe_bytes(pkt)
        self.assertEqual(result["possible_rcsp_flags"], "0x00")
        self.assertEqual(result["possible_rcsp_opcode"], "0x0c")
        self.assertEqual(result["complete_rcsp"]["possible_status"], "0x00")

    def test_partial_fragment_does_not_claim_opcode(self):
        self.assertNotIn("possible_rcsp_opcode", describe_bytes(b"\xfe\xdc\xba\xc0"))

    def test_split_and_coalesced_reassembly(self):
        frame = bytes.fromhex("fe dc ba 00 03 00 03 00 01 05 ef")
        assembler = FrameAssembler()
        self.assertEqual(assembler.feed(frame[:2]), [])
        self.assertEqual(assembler.feed(frame[2:8]), [])
        pair = assembler.feed(frame[8:] + frame)
        self.assertEqual(len(pair), 2)
        self.assertEqual(pair[0]["opcode"], "0x03")
        self.assertEqual(pair[0]["possible_status"], "0x00")

    def test_reject_invalid_frame(self):
        self.assertIsNone(parse_frame(bytes.fromhex("fe dc ba 00 02 00 01 00 00")))
        self.assertIsNone(parse_frame(bytes.fromhex("fe dc ba 00 02 00 02 00 ef")))
        a = FrameAssembler()
        self.assertEqual(a.feed(bytes.fromhex("fe dc ba 00 02 ff ff ef")), [])

    def test_fitpro_stays_separate(self):
        desc = describe_bytes(bytes.fromhex("cd 00 05 1f 01 00 00 00"))
        self.assertTrue(desc["possible_fitpro_frame"])
        self.assertNotIn("possible_rcsp_opcode", desc)

    def test_jsonl_inspection(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            records = [
                {"stream": "ae01", "direction": "tx", "hex": TARGET_INFO_REQUEST.hex()},
                {"stream": "ae02", "direction": "rx", "hex": "fedcba00030003000105ef"},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
            self.assertEqual(inspect(path), 0)


class FakeGattCharacteristic:
    def __init__(self):
        self.properties = ["write-without-response"]


class FakeGattService:
    uuid = "0000ae00-0000-1000-8000-00805f9b34fb"

    def get_characteristic(self, uuid):
        return FakeGattCharacteristic() if uuid == "0000ae01-0000-1000-8000-00805f9b34fb" else None


class FakeServices:
    def __iter__(self):
        return iter([FakeGattService()])

    def get_service(self, uuid):
        return FakeGattService() if uuid == FakeGattService.uuid else None


class FakeBleakClient:
    last = None

    def __init__(self, device, timeout=20.0):
        self.services = FakeServices()
        self.writes = []
        self.subscriptions = []
        FakeBleakClient.last = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def start_notify(self, characteristic, callback):
        self.subscriptions.append(characteristic)

    async def write_gatt_char(self, characteristic, data, response=False):
        self.writes.append((characteristic, bytes(data), response))


class ActiveReadOnlyGateTests(unittest.IsolatedAsyncioTestCase):
    async def run_observation(self):
        import types
        from unittest.mock import AsyncMock, patch
        import bg02_rcsp_observe as observer
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.jsonl"
            fake_bleak = types.SimpleNamespace(BleakClient=FakeBleakClient)
            with patch.dict(sys.modules, {"bleak": fake_bleak}), \
                 patch.object(observer, "locate", AsyncMock(return_value=types.SimpleNamespace(name="BG02"))):
                result = await observer.observe("BG02", 0.001, path, False)
            return result, list(FakeBleakClient.last.writes), list(FakeBleakClient.last.subscriptions)

    async def test_default_mode_never_writes_application_commands(self):
        result, writes, subscriptions = await self.run_observation()
        self.assertEqual(result, 0)
        self.assertEqual(writes, [])
        self.assertEqual(subscriptions, ["0000ae02-0000-1000-8000-00805f9b34fb"])

    async def test_retired_active_probe_never_connects(self):
        from unittest.mock import patch
        import bg02_rcsp_observe as observer
        with patch.object(sys, "argv", ["bg02_rcsp_observe.py", "--probe-target-info"]):
            self.assertEqual(observer.main(), 4)
        # main exits before importing Bleak or opening a connection.



if __name__ == "__main__":
    unittest.main()
