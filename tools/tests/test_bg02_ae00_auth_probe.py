"""Six offline safety checks for optional BG02 AE00 authentication diagnostic."""
from __future__ import annotations

import asyncio
import io
from contextlib import redirect_stdout
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bg02_ae00_auth_probe import (  # noqa: E402
    Ae00AuthTransport, ProtocolGuardError, classify_allowed_write, main,
)


class GuardTests(unittest.TestCase):
    def test_default_dry_run_uses_no_bluetooth(self):
        with io.StringIO() as capture, redirect_stdout(capture):
            self.assertEqual(main([]), 0)
            self.assertIn("OFFLINE", capture.getvalue())

    def test_raw_auth_messages_only(self):
        self.assertEqual(classify_allowed_write(b"\x00" + bytes(16), False),
                         "authentication-challenge-or-response")
        self.assertEqual(classify_allowed_write(b"\x01" + bytes(16), False),
                         "authentication-challenge-or-response")
        self.assertEqual(classify_allowed_write(b"\x02pass", False),
                         "authentication-accept")

    def test_reject_unauthenticated_rcsp(self):
        with self.assertRaises(ProtocolGuardError):
            classify_allowed_write(bytes.fromhex("fe dc ba c0 03 00 06 00 ff ff ff ff 00 ef"), False)

    def test_allow_only_target_info_after_auth(self):
        good = bytes.fromhex("fe dc ba c0 03 00 06 00 ff ff ff ff 00 ef")
        self.assertEqual(classify_allowed_write(good, True), "target-info")
        for op in (0x02, 0x07, 0x0c, 0x24, 0x28, 0xe2):
            invalid = bytearray(good)
            invalid[4] = op
            with self.subTest(opcode=op), self.assertRaises(ProtocolGuardError):
                classify_allowed_write(bytes(invalid), True)

    def test_reject_nonstandard_target_info_parameters(self):
        good = bytearray.fromhex("fe dc ba c0 03 00 06 00 ff ff ff ff 00 ef")
        good[10] = 0x12
        with self.assertRaises(ProtocolGuardError):
            classify_allowed_write(bytes(good), True)


class AsyncTransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_transport_has_one_guarded_application_write(self):
        class FakeClient:
            def __init__(self):
                self.writes = []

            async def write_gatt_char(self, uuid, payload, response):
                self.writes.append((uuid, bytes(payload), response))

        client = FakeClient()
        transport = Ae00AuthTransport(asyncio.get_running_loop(), client)
        await asyncio.to_thread(transport.send_to_ae01, b"\x02pass")
        self.assertEqual(len(client.writes), 1)
        self.assertEqual(client.writes[0][1], b"\x02pass")
        self.assertEqual(transport.writes["authentication-accept"], 1)
        with self.assertRaises(ProtocolGuardError):
            await asyncio.to_thread(transport.send_to_ae01, b"\xcd\x00\x02")
        self.assertEqual(len(client.writes), 1)


if __name__ == "__main__":
    unittest.main()
