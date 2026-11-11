"""Small no-Bluetooth checks for the passive BG02 RCSP observer."""
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "bg02_rcsp_observe.py"
spec = spec_from_file_location("bg02_rcsp_observe", SOURCE)
module = module_from_spec(spec)
assert spec is not None and spec.loader is not None
spec.loader.exec_module(module)


class PassiveObserverTests(unittest.TestCase):
    def test_partial_frame_does_not_claim_opcode(self):
        event = module.describe_bytes(bytes.fromhex("fe dc ba"))
        self.assertEqual(event["rcsp_magic_offset"], 0)
        self.assertNotIn("possible_rcsp_opcode", event)

    def test_recognizes_rcsp_magic_and_possible_opcode(self):
        event = module.describe_bytes(bytes.fromhex("fe dc ba 0c 00 00 00 ef"))
        self.assertEqual(event["possible_rcsp_opcode"], "0x0c")
        self.assertEqual(event["possible_opcode_name"], "FILE_BROWSE_REQUEST_START")

    def test_fitpro_stays_separate(self):
        event = module.describe_bytes(bytes.fromhex("cd 00 05 1f 01 00 00 00"))
        self.assertTrue(event["possible_fitpro_frame"])
        self.assertNotIn("rcsp_magic_offset", event)

    def test_offline_jsonl_inspection(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "sample.jsonl"
            lines = [
                {"stream": "ae02", "elapsed_ms": 5, "hex": "fe dc ba"},
                {"stream": "7e400003", "elapsed_ms": 10, "hex": "cd 00 05 1f"},
            ]
            path.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
            self.assertEqual(module.inspect(path), 0)


if __name__ == "__main__":
    unittest.main()
