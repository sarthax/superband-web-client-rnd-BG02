import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBaselineJpeg444 } from '../js/jpeg444.js';
import { validateBg02Jpeg } from '../js/picture-comparison.js';
import {
  jpegAllocationSummary, jpegTargetAllocation, optimizeJpegAllocation,
} from '../js/jpeg-allocation.js';
import { prepareBg02PictureComparison } from '../js/picture-comparison.js';

function patterned() {
  const width=240,height=240;
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    data[i]=((x*11+y*7)^(x*y))&255;
    data[i+1]=(x*4+y*13)&255;
    data[i+2]=((x*17)^(y*9))&255;
    data[i+3]=255;
  }
  return {width,height,data};
}

test('8KiB boundary includes 4-byte Dial31 length and uses exact integer buckets',()=>{
  assert.deepEqual(jpegAllocationSummary(16380), {
    encodedBytes:16380, transferredBytes:16384,
    allocationBytes:16384, headroomBytes:0,
  });
  assert.deepEqual(jpegAllocationSummary(16381),{
    encodedBytes:16381, transferredBytes:16385,
    allocationBytes:24576, headroomBytes:8191,
  });
  assert.equal(jpegTargetAllocation(16380),16384);
  assert.equal(jpegTargetAllocation(16381,-1),16384);
  assert.equal(jpegTargetAllocation(12000,1),24576);
  assert.throws(()=>jpegTargetAllocation(1000,-1),/no smaller/i);
  assert.throws(()=>jpegAllocationSummary(0));
  assert.throws(()=>jpegTargetAllocation(16380,2));
});

test('optimizer finds highest fitting quality over a bounded range, using actual JPEG bytes',async()=>{
  const src=patterned();
  const base=encodeBaselineJpeg444(src,{quality:69});
  const target=jpegTargetAllocation(base.length);
  const found=await optimizeJpegAllocation(src,target,{minQuality:63,maxQuality:73});
  assert.equal(found.fits,true);
  assert.equal(found.bytes.length+4<=target,true);
  assert.equal(found.targetBytes,target);
  assert.equal(validateBg02Jpeg(found.bytes).ok,true);
  for(let q=found.quality+1;q<=73;q++){
    const higher=encodeBaselineJpeg444(src,{quality:q});
    assert.ok(higher.length+4>target,
      'any better quality between found and maximum must exceed target');
  }
  const result=await prepareBg02PictureComparison(src,{
    jpegQuality:found.quality,preparedJpegBytes:found.bytes,
  });
  assert.deepEqual(result.jpeg.bytes,found.bytes,
    'comparison and upload must reuse the optimized JPEG, not re-encode');
});

test('optimizer reports an impossible smaller bucket instead of overflowing storage',async()=>{
  const result=await optimizeJpegAllocation(patterned(),8192,{
    minQuality:88,maxQuality:90,
  });
  assert.equal(result.fits,false);
  assert.equal(result.trials,3);
  assert.ok(result.minimumSize.encodedBytes>0);
});

test('optimizer checks current image state before every attempt',async()=>{
  let checks=0;
  await assert.rejects(()=>optimizeJpegAllocation(patterned(),8192,{
    minQuality:88,maxQuality:90,
    checkCurrent:()=>++checks<=1,
  }),/changed during JPEG optimization/);
  assert.equal(checks,2);
});
