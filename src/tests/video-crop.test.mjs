import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIDEO_CROP_SIZE, defaultVideoCrop, copyVideoCrop,
  videoCropGeometry, clampVideoCrop, panVideoCrop,
  zoomVideoCrop, drawVideoCrop, resolveVideoFrameCrop,
} from '../js/video-crop.js';

test('a wide rectangular GIF can pan edge-to-edge inside 240px round viewport', () => {
  const center = videoCropGeometry(600, 240, defaultVideoCrop(), 'cover');
  assert.equal(center.drawWidth, 600);
  assert.equal(center.drawHeight, VIDEO_CROP_SIZE);
  assert.equal(center.drawX, -180);
  const right = panVideoCrop(defaultVideoCrop(), 300, 0, 600, 240);
  assert.equal(right.offsetX, 180);
  const edge = videoCropGeometry(600,240,right);
  assert.equal(edge.drawX, 0);
  const left = panVideoCrop(defaultVideoCrop(), -300, 0, 600, 240);
  assert.equal(left.offsetX, -180);
  assert.equal(videoCropGeometry(600,240,left).drawX, -360);
});

test('zoom expands the crop without exposing empty corners in cover mode', () => {
  const picture = { zoom: 3, offsetX: 10000, offsetY: -10000 };
  const bounded = clampVideoCrop(picture, 320, 180, 'cover');
  const g = videoCropGeometry(320,180,bounded);
  assert.ok(g.drawX <= 0 && g.drawX + g.drawWidth >= 240);
  assert.ok(g.drawY <= 0 && g.drawY + g.drawHeight >= 240);
  assert.equal(g.zoom,3);
  assert.equal(clampVideoCrop({zoom:99,offsetX:0,offsetY:0},320,180).zoom,4);
});

test('contain maintains black-bar-sized space and can be moved within it', () => {
  const g=videoCropGeometry(480, 240, defaultVideoCrop(), 'contain');
  assert.equal(g.drawWidth,240);
  assert.equal(g.drawHeight,120);
  assert.equal(g.drawY,60);
  assert.equal(panVideoCrop(defaultVideoCrop(),0,-100,480,240,'contain').offsetY,-60);
});

test('zoom uses exact 240px focal coordinates', () => {
  const initial={zoom:1,offsetX:40,offsetY:0};
  const before=videoCropGeometry(600,240,initial);
  const position=(50-before.drawX)/before.scale;
  const zoomed=zoomVideoCrop(initial,1.5,600,240,'cover',50,120);
  const after=videoCropGeometry(600,240,zoomed);
  assert.ok(Math.abs(50-(after.drawX+position*after.scale))<1e-6);
});

test('copy of crop state is independent of shared/fallback crop', () => {
  const shared=defaultVideoCrop();
  const frame=copyVideoCrop(shared);
  frame.offsetX=19;
  frame.zoom=2;
  assert.deepEqual(shared,{zoom:1,offsetX:0,offsetY:0});
  assert.notEqual(frame.zoom,shared.zoom);
});

test('thumbnail and final AVI draw use identical normalized crop geometry', () => {
  function context(size) {
    const calls=[];
    return {
      canvas:{width:size,height:size},
      save(){},restore(){},fillRect(){},
      drawImage(...args){calls.push(args)},
      set fillStyle(_v){},set imageSmoothingEnabled(_v){},set imageSmoothingQuality(_v){},
      calls,
    };
  }
  const crop={zoom:1.4,offsetX:42,offsetY:-28};
  const image={};
  const final=context(240),thumb=context(112);
  drawVideoCrop(final,image,500,300,crop,'cover');
  drawVideoCrop(thumb,image,500,300,crop,'cover');
  assert.equal(final.calls.length,1);
  assert.equal(thumb.calls.length,1);
  for(let k=1;k<=4;k++)
    assert.ok(Math.abs(final.calls[0][k]*112/240-thumb.calls[0][k])<1e-8);
});

test('invalid inputs are rejected instead of silently producing nonsense', () => {
  assert.throws(()=>videoCropGeometry(0,100));
  assert.throws(()=>videoCropGeometry(100,Infinity));
  assert.throws(()=>videoCropGeometry(100,100,undefined,'garbage'));
});

test('thumbnails and encoder resolve identical per-GIF-frame overrides', () => {
  const shared={zoom:1,offsetX:0,offsetY:0};
  const third={zoom:2.2,offsetX:35,offsetY:-12};
  const map=new Map([[3,third]]);
  assert.strictEqual(resolveVideoFrameCrop(shared,map,3),third);
  assert.strictEqual(resolveVideoFrameCrop(shared,map,2),shared);
  assert.strictEqual(resolveVideoFrameCrop(shared,map,null),shared);
  const objectOverrides={3:third};
  assert.strictEqual(resolveVideoFrameCrop(shared,objectOverrides,3),third);
  assert.strictEqual(resolveVideoFrameCrop(shared,objectOverrides,4),shared);
});
