import test from 'node:test';
import assert from 'node:assert/strict';
import {
  videoAllocationTarget, videoOptimizationProfiles, chooseVideoOptimizationResult,
} from '../js/video-storage-optimizer.js';

test('AVI storage allocation includes Dial31 four-byte prefix at exact 8 KiB boundary',()=>{
  assert.equal(videoAllocationTarget(16380),16384);
  assert.equal(videoAllocationTarget(16381),24576);
  assert.equal(videoAllocationTarget(16381,-1),16384);
  assert.equal(videoAllocationTarget(16380,1),24576);
  assert.throws(()=>videoAllocationTarget(8000,-1),/smaller-than-8KiB/);
  assert.throws(()=>videoAllocationTarget(0),/measured/);
});
test('quality/FPS comparison uses bounded known settings only',()=>{
  assert.deepEqual(videoOptimizationProfiles(1),[
    {fps:1,quality:'high'},{fps:1,quality:'medium'},{fps:1,quality:'low'},
  ]);
  const options=videoOptimizationProfiles(3,true);
  assert.equal(options.length,6);
  assert.deepEqual(new Set(options.map(x=>x.fps)),new Set([1,3]));
  assert.throws(()=>videoOptimizationProfiles(12),/Unsupported/);
});
test('choose highest quality that fits without changing preferred frame rate',()=>{
  const candidates=[
    {fps:3,quality:'high',result:{bytes:new Uint8Array(27000)}},
    {fps:3,quality:'medium',result:{bytes:new Uint8Array(19000)}},
    {fps:3,quality:'low',result:{bytes:new Uint8Array(15500)}},
    {fps:1,quality:'high',result:{bytes:new Uint8Array(12000)}},
  ];
  const chosen=chooseVideoOptimizationResult(candidates,16384,3);
  assert.equal(chosen.fps,3);
  assert.equal(chosen.quality,'low');
  const lowOnly=chooseVideoOptimizationResult(
    candidates.filter(x=>x.fps===1 || x.quality!=='low'),16384,3);
  assert.equal(lowOnly.fps,1);
  assert.equal(lowOnly.quality,'high');
  assert.equal(chooseVideoOptimizationResult(candidates,8192,3),null);
});
