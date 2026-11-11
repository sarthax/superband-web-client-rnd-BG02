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
        self.assertEqual(TARGET_INFO_REQUEST.hex(), "fedcbac002000501ffffffffef")
        result = parse_frame(TARGET_INFO_REQUEST)
        self.assertIsNotNone(result)
        self.assertEqual(result["opcode"], "0x02")
        self.assertEqual(result["flags"], "0xc0")
        self.assertEqual(result["body_length"], 5)
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
        frame = bytes.fromhex("fe dc ba 00 02 00 03 00 01 05 ef")
        assembler = FrameAssembler()
        self.assertEqual(assembler.feed(frame[:2]), [])
        self.assertEqual(assembler.feed(frame[2:8]), [])
        pair = assembler.feed(frame[8:] + frame)
        self.assertEqual(len(pair), 2)
        self.assertEqual(pair[0]["opcode"], "0x02")
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
                {"stream": "ae02", "direction": "rx", "hex": "fedcba00020003000105ef"},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
            self.assertEqual(inspect(path), 0)


if __name__ == "__main__":
    unittest.main()
