/**
 * Experimental LJ733/BG02 image container validator.
 *
 * Format derived from arqueomendez/ebadge (vendor BmpConvert disassembly).
 * This module deliberately does not create ETC2 textures in the browser:
 * encode with the existing Python etcpak tool, then import the RU50 file.
 * No evidence yet that BG02 V35922 accepts RU50 within dial31.
 */
export const RU50_HEADER_SIZE = 0x450;
const NIBBLE_CRC_TABLE = [
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
  0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
];

/** Vendor CRC16: initialization 0, high nibble first, polynomial 0x1021. */
export function ru50Crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    for (const nibble of [b >>> 4, b & 15]) {
      const index = ((crc >>> 12) ^ nibble) & 15;
      crc = (((crc << 4) & 0xffff) ^ NIBBLE_CRC_TABLE[index]) & 0xffff;
    }
  }
  return crc;
}

/** Throws for invalid RU50 content; returns validated metadata on success. */
export function inspectRu50(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < RU50_HEADER_SIZE + 8) {
    throw new Error('RU50 file is too small');
  }
  if (bytes[0] !== 0x52 || bytes[1] !== 0x55 || bytes[2] !== 0x35 || bytes[3] !== 0x30) {
    throw new Error('Missing RU50 magic');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = dv.getUint32(0x4c, true);
  const width = dv.getUint16(0x44, true);
  const height = dv.getUint16(0x46, true);
  const payloadLength = dv.getUint32(0x48, true);
  const flags = dv.getUint32(0x40, true);
  if (headerSize !== RU50_HEADER_SIZE) throw new Error(`RU50 header size invalid: ${headerSize}`);
  if (width !== 240 || height !== 240) {
    throw new Error(`Experimental BG02 path requires 240×240 RU50, got ${width}×${height}`);
  }
  if (payloadLength !== 28800 || bytes.length !== RU50_HEADER_SIZE + payloadLength) {
    throw new Error(`RU50 ETC2 length invalid: ${payloadLength} / ${bytes.length}`);
  }
  if (flags !== 0x00920001 && flags !== 0x00228001) {
    throw new Error(`Unexpected RU50 flags 0x${flags.toString(16)}`);
  }
  if (dv.getUint16(0x3e, true) !== ru50Crc16(bytes.subarray(RU50_HEADER_SIZE))) {
    throw new Error('RU50 ETC2 payload CRC16 mismatch');
  }
  if (dv.getUint16(0x3c, true) !== ru50Crc16(bytes.subarray(0x3e, 0x50))) {
    throw new Error('RU50 header CRC16 mismatch');
  }
  return { width, height, headerSize, payloadLength, flags, totalBytes: bytes.length };
}

/** True if the advertised identity is one of the known LJ733/BG02 variants. */
export function looksLikeBg02(snapshot) {
  const identity = [
    snapshot?.name, snapshot?.model, snapshot?.manufacturer, snapshot?.hardware,
  ].filter(Boolean).join(' ');
  return /\bBG02\b/i.test(identity) || /LJ733[_-]/i.test(identity);
}
