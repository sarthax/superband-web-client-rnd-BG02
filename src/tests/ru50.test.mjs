import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRu50, ru50Crc16, RU50_HEADER_SIZE, looksLikeBg02 } from '../js/ru50.js';

function fixture() {
  const bytes = new Uint8Array(RU50_HEADER_SIZE + 28800);
  bytes.set([0x52, 0x55, 0x35, 0x30], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x40, 0x00920001, true);
  view.setUint16(0x44, 240, true);
  view.setUint16(0x46, 240, true);
  view.setUint32(0x48, 28800, true);
  view.setUint32(0x4c, RU50_HEADER_SIZE, true);
  bytes[RU50_HEADER_SIZE] = 0xc7;
  view.setUint16(0x3e, ru50Crc16(bytes.subarray(RU50_HEADER_SIZE)), true);
  view.setUint16(0x3c, ru50Crc16(bytes.subarray(0x3e, 0x50)), true);
  return bytes;
}

test('vendor nibble CRC16 recurrence', () => {
  assert.equal(ru50Crc16(new Uint8Array()), 0);
  assert.equal(ru50Crc16(Uint8Array.of(0x12, 0x34)), 0x13c6);
});

test('valid 240x240 RU50 frame length and CRC validation', () => {
  const image = fixture();
  assert.equal(inspectRu50(image).totalBytes, 29904);
  assert.equal(inspectRu50(image).payloadLength, 28800);
  image[RU50_HEADER_SIZE] ^= 1;
  assert.throws(() => inspectRu50(image), /payload CRC16/);
});

test('corrupt magic and invalid display dimensions rejected', () => {
  const image = fixture();
  image[0] = 0;
  assert.throws(() => inspectRu50(image), /RU50 magic/);
  image[0] = 0x52;
  new DataView(image.buffer).setUint16(0x44, 360, true);
  assert.throws(() => inspectRu50(image), /requires 240/);
});

test('RU50 upload identity limited to BG02 and LJ733', () => {
  assert.equal(looksLikeBg02({ name: 'BG02' }), true);
  assert.equal(looksLikeBg02({ hardware: 'LJ733_MB_V1.5' }), true);
  assert.equal(looksLikeBg02({ name: 'DG01', hardware: 'E87_MB' }), false);
  assert.equal(looksLikeBg02({}), false);
});
