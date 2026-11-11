"""Offline-only BLE advertisement comparison checks; no Bleak required."""
from __future__ import annotations

import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bg02_peer_advertisements import (  # noqa: E402
    PhaseRecorder, advertisement_signature, compare, summarize, SCHEMA,
)


def adv(name, mfg=None):
    return SimpleNamespace(
        local_name=name, service_uuids=["0000AE00-0000-1000-8000-00805F9B34FB"],
        manufacturer_data=mfg or {}, service_data={}, rssi=-57,
    )


class PeerAdvertisementTests(unittest.TestCase):
    def test_packet_fingerprint_is_stable_and_does_not_copy_raw_address(self):
        record = PhaseRecorder("normal")
        record.record(SimpleNamespace(address="AA:BB:CC:DD:EE:FF", name="BG02"),
                      adv("BG02", {0x1234: b"\x10\x20\x30"}))
        data = record.result()
        text = json.dumps(data)
        self.assertEqual(len(data["devices"]), 1)
        self.assertNotIn("AA:BB:CC:DD:EE:FF", text)
        self.assertNotIn("102030", text)
        self.assertIn("4660", text)  # vendor/manufacturer ID, not secret data
        self.assertIn("sha256_prefix", text)

    def test_compare_changed_advertisement(self):
        device = SimpleNamespace(address="11:22:33:44:55:66", name="BG02")
        baseline, receiver = PhaseRecorder("normal"), PhaseRecorder("receive")
        baseline.record(device, adv("BG02"))
        receiver.record(device, adv("wallpaper_adv", {3: b"\x10"}))
        result = compare(baseline.result(), receiver.result())
        self.assertEqual(result["changed_count"], 1)
        self.assertEqual(result["new_count"], 0)
        self.assertEqual(result["changed_named_candidates"][0]["name"], "wallpaper_adv")

    def test_compare_new_named_receiver(self):
        baseline, receiver = PhaseRecorder("normal"), PhaseRecorder("receive")
        baseline.record(SimpleNamespace(address="01", name="Other"), adv("Other"))
        receiver.record(SimpleNamespace(address="02", name="wallpaper_adv"), adv("wallpaper_adv"))
        result = compare(baseline.result(), receiver.result())
        self.assertEqual(result["new_count"], 1)
        self.assertEqual(result["new_named_candidates"][0]["name"], "wallpaper_adv")

    def test_summary_rejects_malformed_phase_order(self):
        with self.assertRaises(ValueError):
            summarize({"schema": SCHEMA, "phases": [{"phase": "receive"}, {"phase": "normal"}]})

    def test_cached_name_not_part_of_packet_signature(self):
        first = advertisement_signature("BG02", adv(None))
        second = advertisement_signature("Other Windows cached name", adv(None))
        from bg02_peer_advertisements import _signature_key
        self.assertEqual(_signature_key(first), _signature_key(second))


if __name__ == "__main__":
    unittest.main()
