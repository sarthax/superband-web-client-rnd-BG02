import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFitProStorageRequest,
  parseFitProStorageResponse,
  isFitProStoragePacket,
  parseDialInfo,
} from '../js/fitpro.js';
import { parsePacket } from '../js/protocol.js';

test('BG02 storage request matches the Android HCI write', () => {
  assert.deepEqual(
    [...buildFitProStorageRequest()],
    [0xcd, 0, 5, 0x20, 1, 4, 0, 0],
  );
});

test('BG02 0x20/4 response decodes the changing second big-endian word', () => {
  const before = Uint8Array.from([0xcd, 0, 13, 0x20, 1, 4, 0, 8,
    0, 0, 0, 0, 0, 3, 0x20, 0]);
  const after = Uint8Array.from([0xcd, 0, 13, 0x20, 1, 4, 0, 8,
    0, 0, 0, 0, 0, 2, 0x80, 0]);
  const a = parsePacket(before);
  const b = parsePacket(after);
  assert.equal(isFitProStoragePacket(a), true);
  assert.equal(isFitProStoragePacket(b), true);
  assert.deepEqual(parseFitProStorageResponse(a.payload), {
    word0: 0,
    reportedBytes: 204800,
  });
  assert.deepEqual(parseFitProStorageResponse(b.payload), {
    word0: 0,
    reportedBytes: 163840,
  });
  assert.equal(204800 - 163840, 40960);
});

test('BG02 storage decoder rejects invalid/short payloads', () => {
  assert.equal(parseFitProStorageResponse(new Uint8Array(0)), null);
  assert.equal(parseFitProStorageResponse(new Uint8Array(4)), null);
});

test('BG02 dial-info fixture identifies LJ733 and K66 without guessing', () => {
  const payload = Uint8Array.from([
    0x01,0x00,0x00,0xf0,0x00,0xf0,0x03,0x4b,0x36,0x36,
    0x05,0x4c,0x4a,0x37,0x33,0x33,0x07,0x04,0xff,0xfe,
    0x01,0x05,0x4a,0x51,0x30,0x30,0x31,0x00,0x00,0x09,
    0x13,0x88,
  ]);
  const info = parseDialInfo(payload);
  assert.equal(info.width, 240);
  assert.equal(info.height, 240);
  assert.equal(info.mchModel, 'K66');
  assert.equal(info.mainModel, 'LJ733');
  assert.equal(info.algorithm, 4);
  assert.equal(info.shortPkgLength, 5000);
});
