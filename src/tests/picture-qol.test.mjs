import test from 'node:test';
import assert from 'node:assert/strict';
import { cropGeometry, PHOTO_MIN_ZOOM, PHOTO_MAX_ZOOM } from '../js/circle-crop.js';
import { estimatePictureStorage, BG02_PICTURE_SIZE } from '../js/picture-size.js';

test('photo editor zooms out to 25% and still caps at 400%', () => {
  assert.equal(PHOTO_MIN_ZOOM, 0.25);
  assert.equal(PHOTO_MAX_ZOOM, 4);
  const zoomedOut = cropGeometry(600, 400, 0.25, 0, 0, 320);
  assert.equal(zoomedOut.zoom, 0.25);
  assert.equal(zoomedOut.drawWidth, 120);
  assert.equal(zoomedOut.drawHeight, 80);
  assert.equal(zoomedOut.drawX, 100);
  assert.equal(zoomedOut.drawY, 120);
  assert.equal(cropGeometry(600, 400, 0.01).zoom, 0.25);
  assert.equal(cropGeometry(600, 400, 999).zoom, 4);
});

test('panning a zoomed-out photo repositions within black margins', () => {
  const right = cropGeometry(600, 400, 0.25, 9999, 0, 320);
  assert.equal(right.drawX, 200); // right edge flush with viewport
  assert.equal(right.drawX + right.drawWidth, 320);
  const left = cropGeometry(600, 400, 0.25, -9999, 0, 320);
  assert.equal(left.drawX, 0);
  assert.equal(left.drawWidth, 120);
});

test('default picture framing remains the original center cover', () => {
  const normal = cropGeometry(600, 400, 1, 0, 0, 320);
  assert.equal(normal.zoom, 1);
  assert.equal(normal.drawWidth, 480);
  assert.equal(normal.drawHeight, 320);
  assert.equal(normal.drawX, -80);
  assert.equal(normal.drawY, 0);
});

test('BG02 picture size is exact independent of original JPG/PNG file size', () => {
  assert.equal(BG02_PICTURE_SIZE, 29904);
  const a = estimatePictureStorage({
    bg02: true, sourceBytes: 20000, availableBytes: 237568,
  });
  const b = estimatePictureStorage({
    bg02: true, sourceBytes: 3500000, availableBytes: 237568,
  });
  assert.equal(a.encodedBytes, 29904);
  assert.equal(b.encodedBytes, 29904);
  assert.equal(a.transferredBytes, 29908);
  assert.equal(a.allocationHint, 32768);
  assert.equal(a.freeAfterHint, 204800);
  assert.equal(a.fits, true);
  assert.equal(b.allocationHint, a.allocationHint);
});

test('insufficient free space is reported but does not silently alter upload', () => {
  const v = estimatePictureStorage({
    bg02: true, sourceBytes: 25000, availableBytes: 16384,
  });
  assert.equal(v.fits, false);
  assert.equal(v.freeAfterHint, 0);
  assert.equal(estimatePictureStorage({ bg02: true }).fits, null);
});

test('generic Baji picture size never guesses its flash allocation', () => {
  const b = estimatePictureStorage({
    bg02: false, encodedBytes: 4300, sourceBytes: 5000, availableBytes: 10000,
  });
  assert.equal(b.encodedBytes, 4300);
  assert.equal(b.allocationHint, null);
  assert.equal(b.fits, null);
  assert.equal(estimatePictureStorage({ bg02: false }), null);
});
