"""JieLi RCSP framing for a bounded BG02 read-only identity probe.

This is not a BG02 filesystem implementation or a firmware programmer.
Protocol evidence comes from public JieLi SDK documentation and captured
traffic on related (not necessarily identical) JieLi devices.
"""
from __future__ import annotations

MAGIC = b"\xfe\xdc\xba"
END = 0xEF
MAX_BODY = 4096
KNOWN_OPCODES = {
    0x02: "GET_TARGET_INFO",
    0x03: "GET_TARGET_FEATURE",
    0x07: "SYS_INFO_GET",
    0x09: "SYS_INFO_AUTO_UPDATE",
    0x0C: "FILE_BROWSE_REQUEST_START",
    0x0D: "FILE_BROWSE_REQUEST_STOP",
    0x24: "ONE_FILE_TRANS_BACK",
}

# Observed on a related JieLi device: opcode 2, sn 1, feature mask FFFFFFFF.
# Read-only target identity/capability request, not file browsing or OTA.
TARGET_INFO_REQUEST = bytes.fromhex("fe dc ba c0 02 00 05 01 ff ff ff ff ef")


def parse_frame(frame: bytes) -> dict | None:
    """Decode one complete FE-framed packet, not a partial fragment."""
    if len(frame) < 8 or not frame.startswith(MAGIC) or frame[-1] != END:
        return None
    length = int.from_bytes(frame[5:7], "big")
    if length > MAX_BODY or len(frame) != 8 + length:
        return None
    flags, opcode = frame[3], frame[4]
    body = frame[7:-1]
    info = {
        "flags": f"0x{flags:02x}",
        "opcode": f"0x{opcode:02x}",
        "opcode_name": KNOWN_OPCODES.get(opcode, "UNKNOWN"),
        "body_length": length,
        "body_hex": body.hex(),
    }
    if flags == 0x00 and len(body) >= 2:
        info["possible_status"] = f"0x{body[0]:02x}"
        info["possible_serial"] = body[1]
    elif flags == 0xC0 and len(body) >= 1:
        info["possible_serial"] = body[0]
    return info


class FrameAssembler:
    """Recover full FE frames from split/coalesced notifications.

    Raw authentication responses are not FE framed. Frame lengths are bounded.
    """
    def __init__(self) -> None:
        self.buffer = bytearray()

    def feed(self, chunk: bytes) -> list[dict]:
        self.buffer.extend(chunk)
        decoded: list[dict] = []
        while self.buffer:
            start = self.buffer.find(MAGIC)
            if start == -1:
                self.buffer = self.buffer[-2:]  # partial magic across notifies
                break
            if start:
                del self.buffer[:start]
            if len(self.buffer) < 7:
                break
            length = int.from_bytes(self.buffer[5:7], "big")
            if length > MAX_BODY:
                del self.buffer[0]
                continue
            total = 8 + length
            if len(self.buffer) < total:
                break
            result = parse_frame(bytes(self.buffer[:total]))
            if result is None:
                del self.buffer[0]
                continue
            decoded.append(result)
            del self.buffer[:total]
        return decoded


def describe_bytes(data: bytes) -> dict:
    """Raw-fragment fingerprint with correct flag/opcode byte offsets."""
    out = {"size": len(data), "hex": data.hex()}
    start = data.find(MAGIC)
    if start >= 0:
        out["rcsp_magic_offset"] = start
        if len(data) >= start + 4:
            out["possible_rcsp_flags"] = f"0x{data[start + 3]:02x}"
        if len(data) >= start + 5:
            op = data[start + 4]
            out["possible_rcsp_opcode"] = f"0x{op:02x}"
            if op in KNOWN_OPCODES:
                out["possible_opcode_name"] = KNOWN_OPCODES[op]
        if len(data) >= start + 7:
            out["declared_length"] = int.from_bytes(data[start + 5:start + 7], "big")
        if start == 0:
            complete = parse_frame(data)
            if complete is not None:
                out["complete_rcsp"] = complete
    if data.startswith(b"\xcd"):
        out["possible_fitpro_frame"] = True
    return out
