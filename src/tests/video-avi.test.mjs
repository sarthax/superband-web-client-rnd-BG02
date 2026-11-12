import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BG02_VIDEO,
  muxBg02MjpegAvi,
  inspectBg02MjpegAvi,
  extractBg02AviFrame,
  estimateVideoAllocation,
} from '../js/video-avi.js';

// This fixture checks RIFF/index structure, not browser JPEG encoder quality.
const fakeJpeg = Uint8Array.from([0xff, 0xd8, ...Array(160).fill(0x11), 0xff, 0xd9]);
const fourCC = (b, i) => String.fromCharCode(...b.subarray(i, i + 4));
const read32 = (b, i) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i, true);

for (const seconds of [5, 10, 15, 20, 30]) {
  test('AVI roundtrip structure for ' + seconds + ' seconds at 3fps', () => {
    const count = seconds * 3;
    const bytes = muxBg02MjpegAvi(Array(count).fill(fakeJpeg));
    const info = inspectBg02MjpegAvi(bytes);
    assert.equal(fourCC(bytes, 0), 'RIFF');
    assert.equal(fourCC(bytes, 8), 'AVI ');
    assert.equal(read32(bytes, 4) + 8, bytes.length);
    assert.equal(info.width, 240);
    assert.equal(info.height, 240);
    assert.equal(info.fps, 3);
    assert.equal(info.frames, count);
    assert.equal(info.seconds, seconds);
    assert.equal(info.bytes, bytes.length);

    // AVI idx1 is at the tail, one 16-byte index entry per MJPEG keyframe.
    const indexHeader = bytes.length - count * 16 - 8;
    assert.equal(fourCC(bytes, indexHeader), 'idx1');
    assert.equal(read32(bytes, indexHeader + 4), 16 * count);
    assert.equal(fourCC(bytes, indexHeader + 8), '00dc');
    assert.equal(read32(bytes, indexHeader + 12), 0x10);
    assert.equal(read32(bytes, indexHeader + 16), 4); // first '00dc' in movi
    assert.equal(read32(bytes, indexHeader + 20), fakeJpeg.length);
    assert.equal(read32(bytes, indexHeader + 32), 4 + 8 + fakeJpeg.length);
  });
}

test('allocation is a hint, not a capacity estimate', () => {
  assert.equal(BG02_VIDEO.VERIFIED_SECONDS, 5);
  assert.equal(BG02_VIDEO.FPS, 3);
  assert.equal(estimateVideoAllocation(29904), 32768);
  assert.equal(estimateVideoAllocation(32768), 40960);
  assert.equal(estimateVideoAllocation(32769), 40960);
});

test('reject non AVI and wrong dimensions/rates before transfer', () => {
  assert.throws(() => inspectBg02MjpegAvi(Uint8Array.of(0, 1, 2)));
  assert.throws(() => muxBg02MjpegAvi([]));
  assert.throws(() => muxBg02MjpegAvi(Array(91).fill(fakeJpeg)));
  assert.throws(() => muxBg02MjpegAvi([fakeJpeg], { width: 360 }));
  assert.throws(() => muxBg02MjpegAvi([fakeJpeg], { fps: 12 }));
  assert.throws(() => muxBg02MjpegAvi([new Uint8Array(150)]));
});

test('existing AVI can be passed through unchanged with first frame extracted', () => {
  const avi = muxBg02MjpegAvi([fakeJpeg, fakeJpeg, fakeJpeg]);
  const first = extractBg02AviFrame(avi, 0);
  const third = extractBg02AviFrame(avi, 2);
  assert.deepEqual([...first], [...fakeJpeg]);
  assert.deepEqual([...third], [...fakeJpeg]);
  assert.throws(() => extractBg02AviFrame(avi, 3));
});

test('AVI uses exact rational headers at experimental frame rates', () => {
  const timebases = [
    {fps: 3, rate: 3, scale: 1, microseconds: 333333, frames: 15, seconds: 5},
    {fps: 2, rate: 2, scale: 1, microseconds: 500000, frames: 10, seconds: 5},
    {fps: 1, rate: 1, scale: 1, microseconds: 1000000, frames: 5, seconds: 5},
    // Under a strict 5s maximum: only two 2s frames fit (4s actual).
    {fps: 0.5, rate: 1, scale: 2, microseconds: 2000000, frames: 2, seconds: 4},
  ];
  for (const t of timebases) {
    const avi = muxBg02MjpegAvi(Array(t.frames).fill(fakeJpeg), { fps: t.fps });
    const info = inspectBg02MjpegAvi(avi);
    assert.equal(info.fps, t.fps);
    assert.equal(info.frames, t.frames);
    assert.equal(info.seconds, t.seconds);
    const tags = (tag) => {
      for (let i = 0; i < avi.length - 4; i++) {
        if (fourCC(avi, i) === tag) return i;
      }
      throw new Error('Missing AVI chunk: ' + tag);
    };
    const avih = tags('avih');
    const strh = tags('strh');
    assert.equal(read32(avi, avih + 8), t.microseconds, 'avih timebase ' + t.fps);
    assert.equal(read32(avi, strh + 8 + 20), t.scale, 'dwScale ' + t.fps);
    assert.equal(read32(avi, strh + 8 + 24), t.rate, 'dwRate ' + t.fps);
    assert.equal(read32(avi, strh + 8 + 32), t.frames, 'dwLength ' + t.fps);
  }
});

test('reject unsupported fractional rates and overlong AVI at low fps', () => {
  assert.throws(() => muxBg02MjpegAvi([fakeJpeg], { fps: 0.75 }));
  assert.throws(() => muxBg02MjpegAvi([fakeJpeg], { fps: 12 }));
  assert.throws(() => muxBg02MjpegAvi(Array(16).fill(fakeJpeg), { fps: 0.5 }));
});
