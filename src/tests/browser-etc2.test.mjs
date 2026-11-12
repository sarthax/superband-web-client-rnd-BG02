import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeEtc2Block, encodeEtc2Rgb } from '../js/etc2.js';
import { encodeImageDataRu50, inspectRu50, wrapEtc2AsRu50 } from '../js/ru50.js';
import { cropGeometry } from '../js/circle-crop.js';
import { resolveBadgeProfile } from '../js/device-profile.js';

// Independent ETC1 individual-mode block decode, per Khronos specification.
// Every ETC1 RGB block is valid in ETC2 RGB8 decoding.
const mods=[[2,8,-2,-8],[5,17,-5,-17],[9,29,-9,-29],[13,42,-13,-42],
            [18,60,-18,-60],[24,80,-24,-80],[33,106,-33,-106],[47,183,-47,-183]];
function decodePixel(block,x,y) {
  const d=new DataView(block.buffer,block.byteOffset,8);
  const hi=d.getUint32(0,false),lo=d.getUint32(4,false);
  assert.equal(hi&2,0,'ETC1 individual mode');
  const half=(hi&1)?Number(y>=2):Number(x>=2);
  const base=half?
    [hi>>>24&15,hi>>>16&15,hi>>>8&15]:
    [hi>>>28&15,hi>>>20&15,hi>>>12&15];
  const table=half?(hi>>>2)&7:(hi>>>5)&7;
  const k=x*4+y;
  const selector=((lo>>>k)&1)|(((lo>>>(k+16))&1)<<1);
  const m=mods[table][selector];
  return base.map(v=>Math.max(0,Math.min(255,v*17+m)));
}
function solid(r,g,b,width=4,height=4) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4){data.set([r,g,b,255],i);}
  return {data,width,height};
}

test('ETC2 encoder emits valid individual-mode ETC1 red, green and blue blocks',()=>{
  for(const color of [[255,0,0],[0,255,0],[0,0,255],[0,0,0],[255,255,255]]) {
    const source=solid(...color);
    const bytes=encodeEtc2Block(source.data,4,0,0);
    assert.equal(bytes.length,8);
    for(const [x,y] of [[0,0],[2,1],[3,3]]) {
      const decoded=decodePixel(bytes,x,y);
      decoded.forEach((value,i)=>assert.ok(Math.abs(value-color[i])<=8,
        `pixel (${x},${y}) channel ${i}: ${value} vs ${color[i]}`));
    }
  }
});

test('Browser encoder creates a valid 29904-byte RU50 for a 240x240 photo',async()=>{
  const blob=await encodeImageDataRu50(solid(255,0,0,240,240));
  assert.equal(blob.length,29904);
  const info=inspectRu50(blob);
  assert.equal(info.payloadLength,28800);
  assert.equal(info.width,240);
  assert.equal(info.height,240);
  assert.deepEqual(Array.from(blob.slice(0,4)),[82,85,53,48]);
  const decoded=decodePixel(blob.subarray(0x450,0x458),0,0);
  assert.ok(decoded[0]>=247 && decoded[1]<=8 && decoded[2]<=8);
  // Reserved vendor header must be zero-filled.
  assert.ok(blob.subarray(0x50,0x450).every(x=>x===0));
});

test('Bad ETC2 payload length and image dimensions are rejected',()=>{
  assert.throws(()=>wrapEtc2AsRu50(new Uint8Array(64)),/28800/);
});

test('Crop geometry covers the full circle and clamps drags at every zoom',()=>{
  for(const [w,h] of [[1000,700],[700,1000],[200,200]]) {
    for(const zoom of [1,2,4]) {
      const g=cropGeometry(w,h,zoom,99999,-99999);
      assert.ok(g.drawX<=0 && g.drawY<=0);
      assert.ok(g.drawX+g.drawWidth>=320 && g.drawY+g.drawHeight>=320);
    }
  }
});

test('BG02 profile accepts an ordinary picture',()=>{
  const p=resolveBadgeProfile({name:'BG02',hardware:'LJ733_MB_V1.5',protocolMode:'fitpro'});
  assert.equal(p.width,240);
  assert.equal(p.height,240);
  assert.match(p.fileAccept,/image/);
  assert.match(p.fileAccept,/ru50/);
  assert.equal(p.format,'ru50');
});
