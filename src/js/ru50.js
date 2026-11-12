/**
 * BG02/LJ733 RU50 image wrapper and validator.
 * Header constants/CRCs from vendor BmpConvert disassembly reported by
 * arqueomendez/ebadge. Browser ETC2 encoder uses valid ETC1-subset blocks.
 * Hardware confirmation of this browser encoder is still required.
 */
import { encodeEtc2Rgb } from './etc2.js';

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
  return /\bBG02\b/i.test(identity) || /LJ733_MB_V1\.(?:1|5)\b/i.test(identity);
}

/**
 * Wrap an ETC2 RGB8 stream in the 0x450-byte vendor RU50 header.
 * The flags and populated field offsets mirror the verified Python wrapper.
 */
export function wrapEtc2AsRu50(payload, width = 240, height = 240) {
  if (!(payload instanceof Uint8Array) || width !== 240 || height !== 240 ||
      payload.length !== width * height / 2) {
    throw new Error('BG02 RU50 needs exactly 28800 bytes of 240×240 ETC2 RGB8 data');
  }
  const bytes = new Uint8Array(RU50_HEADER_SIZE + payload.length);
  bytes.set([0x52,0x55,0x35,0x30], 0); // "RU50"
  const view = new DataView(bytes.buffer);
  // Constants taken from vendor BmpConvert br35_bmp_to_res, LE.
  view.setBigUint64(0x04, 0x0000000100010500n, true);
  view.setBigUint64(0x10, 0x0000001800000000n, true);
  view.setBigUint64(0x18, 0x0054000100000030n, true);
  view.setBigUint64(0x20, 0x0000003c00000000n, true);
  view.setBigUint64(0x28, 0x0000000000500001n, true);
  view.setBigUint64(0x30, 0x0000005000000100n, true);
  view.setUint32(0x38, 0x400, true);
  view.setUint32(0x40, 0x00920001, true);
  view.setUint16(0x44, width, true);
  view.setUint16(0x46, height, true);
  view.setUint32(0x48, payload.length, true);
  view.setUint32(0x4c, RU50_HEADER_SIZE, true);
  // The 0x50..0x450 reserved region is intentionally zero.
  bytes.set(payload, RU50_HEADER_SIZE);
  view.setUint16(0x3e, ru50Crc16(payload), true);
  view.setUint16(0x3c, ru50Crc16(bytes.subarray(0x3e,0x50)), true);
  inspectRu50(bytes);
  return bytes;
}

/** Convert a 240×240 RGBA crop directly to the BG02 RU50 upload bytes. */
export async function encodeImageDataRu50(imageData) {
  if (!imageData || imageData.width !== 240 || imageData.height !== 240) {
    throw new Error('BG02 crop must be 240×240');
  }
  const payload = await encodeEtc2Rgb(imageData);
  return wrapEtc2AsRu50(payload, 240, 240);
}
