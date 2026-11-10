#!/usr/bin/env python3
"""Convert a picture to BG02 RU50 using the existing arqueomendez/ebadge encoder.

Requires the ebadge project's Python environment (Pillow + etcpak). This tool
creates a data file only: it never connects over Bluetooth or flashes firmware.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import struct
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ebadge-root", type=Path, required=True, help="Local arqueomendez/ebadge checkout")
    parser.add_argument("--input", type=Path, required=True, help="PNG/JPEG source")
    parser.add_argument("--output", type=Path, help="Destination .ru50 file")
    args = parser.parse_args()

    root = args.ebadge_root.resolve()
    if not (root / "ebadge" / "ru50.py").is_file():
        parser.error(f"{root} does not contain ebadge/ru50.py")
    if not args.input.is_file():
        parser.error(f"input file does not exist: {args.input}")
    sys.path.insert(0, str(root))
    from ebadge.ru50 import image_to_ru50  # noqa: E402

    output = args.output or args.input.with_suffix(".ru50")
    data = image_to_ru50(str(args.input), 240, 240, fit="cover")
    if data[:4] != b"RU50" or len(data) != 29904:
        raise SystemExit(f"Unexpected RU50 output length/header: {len(data)} bytes")
    if struct.unpack_from("<I", data, 0x48)[0] != 28800:
        raise SystemExit("Unexpected ETC2 length in RU50 header")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    print(f"Created {output} ({len(data)} bytes, RU50 / 240x240 ETC2)")
    print("Experimental: BG02 V35922 device acceptance is not yet verified.")


if __name__ == "__main__":
    main()
