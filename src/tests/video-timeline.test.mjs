import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrimmedVideo, planGifStoryboard } from '../js/video-timeline.js';

test('3-second GIF under 5-second maximum produces 9 frames without padding', () => {
  const p = planTrimmedVideo({ start: 0, end: 3, maxSeconds: 5 });
  assert.equal(p.frameCount, 9);
  assert.equal(p.seconds, 3);
  assert.equal(p.repeated, false);
  assert.ok(p.sourceTimes.every(t => t >= 0 && t < 3));
  assert.deepEqual(p.sourceTimes.map(t => Math.round(t * 3)), [0,1,2,3,4,5,6,7,8]);
});

test('maximum caps longer source without moving source end marker', () => {
  const p = planTrimmedVideo({ start: 2, end: 13, maxSeconds: 5 });
  assert.equal(p.frameCount, 15);
  assert.equal(p.seconds, 5);
  assert.equal(p.sourceTimes[0], 2);
  assert.ok(p.sourceTimes.every(t => t < 7));
  assert.equal(p.repeated, false);
});

test('only explicit repeat pads a 3-second selection to 5s', () => {
  const p = planTrimmedVideo({ start: 0, end: 3, maxSeconds: 5, loop: true });
  assert.equal(p.frameCount, 15);
  assert.equal(p.seconds, 5);
  assert.equal(p.repeated, true);
  assert.deepEqual(p.sourceTimes.slice(9).map(t=>Math.round(t*3)), [0,1,2,3,4,5]);
});

test('noninteger durations round down to whole 3fps frames', () => {
  assert.equal(planTrimmedVideo({ start: 0, end: 3.1, maxSeconds: 5 }).frameCount, 9);
  assert.equal(planTrimmedVideo({ start: 0, end: .1, maxSeconds: 5 }).frameCount, 1);
});

test('select original GIF frames in chronological order without auto-padding', () => {
  const p = planGifStoryboard({ frameIndices: [10,3,7,3], sourceFrameCount: 20,
    holdFrames: 1, maxSeconds: 5 });
  assert.equal(p.frameCount, 3);
  assert.equal(p.seconds, 1);
  assert.deepEqual(p.frameIndexes, [3,7,10]);
  assert.equal(p.repeated, false);
});

test('five chosen frames at one frame each = 1.67 second AVI', () => {
  const p = planGifStoryboard({frameIndices:[0,4,8,12,16],sourceFrameCount: 50,
    holdFrames:1,maxSeconds:5});
  assert.equal(p.frameCount,5);
  assert.equal(p.seconds,5/3);
  assert.deepEqual(p.frameIndexes,[0,4,8,12,16]);
});

test('five chosen frames held for one second each fill exactly five-second maximum', () => {
  const p = planGifStoryboard({frameIndices:[0,4,8,12,16],sourceFrameCount:50,
    holdFrames:3,maxSeconds:5});
  assert.equal(p.frameCount,15);
  assert.equal(p.seconds,5);
  assert.deepEqual(p.frameIndexes.slice(0,6),[0,0,0,4,4,4]);
});

test('manual storyboard stops at maximum instead of repeating', () => {
  const p=planGifStoryboard({frameIndices:[0,1,2,3,4,5],sourceFrameCount:20,
    holdFrames:3,maxSeconds:5});
  assert.equal(p.frameCount,15);
  assert.equal(p.clipped,true);
  assert.deepEqual(p.frameIndexes.slice(-3),[4,4,4]);
});

test('manual storyboard repeats only on deliberate checkbox selection', () => {
  const p = planGifStoryboard({frameIndices:[2,8],sourceFrameCount:20,
    holdFrames:1,maxSeconds:5,loop:true});
  assert.equal(p.frameCount,15);
  assert.equal(p.repeated,true);
  assert.deepEqual(p.frameIndexes.slice(0,6),[2,8,2,8,2,8]);
});

test('invalid GIF frame indexes and empty selection fail before encoding', () => {
  assert.throws(()=>planGifStoryboard({frameIndices:[],sourceFrameCount:5}));
  assert.throws(()=>planGifStoryboard({frameIndices:[5],sourceFrameCount:5}));
  assert.throws(()=>planGifStoryboard({frameIndices:[0],sourceFrameCount:5,holdFrames:4}));
  assert.throws(()=>planTrimmedVideo({start:3,end:3,maxSeconds:5}));
});
