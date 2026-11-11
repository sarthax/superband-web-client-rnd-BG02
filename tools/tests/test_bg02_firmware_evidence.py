"""Offline tests for the bounded BG02 firmware evidence scanner."""
from __future__ import annotations
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
import zipfile

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from bg02_firmware_evidence import classify, scan_source, main  # noqa: E402


class FirmwareEvidenceTests(unittest.TestCase):
    def test_ascii_and_utf16_anchors(self):
        data = b"app start\x00/bgP_WA%d.avi\x00" + "wallpaper_adv".encode("utf-16le")
        result = classify(data, "app.bin")
        self.assertIn("wallpaper_storage", result["hits"])
        self.assertIn("wallpaper_sharing", result["hits"])
        self.assertEqual(result["capability_verdict"], "UNVERIFIED_BY_TEXT_SCAN")

    def test_no_strings_not_a_negative_capability(self):
        result = classify(bytes(range(256)), "app.bin")
        self.assertEqual(result["capability_verdict"], "UNVERIFIED_BY_TEXT_SCAN")
        self.assertEqual(result["hits"], {})

    def test_scans_zip_without_extraction(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "lj733.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("app.ufw", b"JLOTA")
                archive.writestr("app.bin", b"bgp_wa%d.avi rcsp_auth")
                archive.writestr("notes.exe", b"ignored")
            report = scan_source(path)
            self.assertEqual(len(report["entries"]), 2)
            self.assertTrue(any(e["packed_container_warning"] for e in report["entries"]))
            self.assertTrue(any("UFW scanned as opaque" in n for n in report["notes"]))
            self.assertTrue(any("auth" in e["hits"] for e in report["entries"]))
            self.assertFalse((Path(tmp) / "app.bin").exists())

    def test_skips_large_zip_member(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "huge.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("huge.bin", b"x" * (24 * 1024 * 1024 + 1))
            result = scan_source(path)
            self.assertEqual(len(result["entries"]), 0)
            self.assertEqual(result["skipped"][0]["reason"], "member too large")

    def test_json_cli(self):
        with TemporaryDirectory() as tmp:
            inp = Path(tmp) / "app.bin"
            report = Path(tmp) / "evidence.json"
            inp.write_bytes(b"watch.sty JLHWJPEG")
            self.assertEqual(main([str(inp), "--json-out", str(report)]), 0)
            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["scope"], "OFFLINE-TEXT-ANCHORS-ONLY")
            self.assertEqual(data["sources"][0]["entries"][0]["kind"], "bin")

    def test_missing_path_returns_error(self):
        self.assertEqual(main(["/unlikely/path/bg02-missing-firmware.bin"]), 2)


if __name__ == "__main__":
    unittest.main()
