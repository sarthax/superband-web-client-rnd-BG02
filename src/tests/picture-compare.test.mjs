import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBg02PictureComparison, validateBg02Jpeg } from '../js/picture-comparison.js';
import { decodeEtc2IndividualRgb } from '../js/etc2.js';
import { inspectRu50 } from '../js/ru50.js';
import { estimatePictureStorage } from '../js/picture-size.js';
import { resolveBadgeProfile, imageMatchesBadge } from '../js/device-profile.js';

function solid(r,g,b) {
  const data=new Uint8ClampedArray(240*240*4);
  for(let i=0;i<data.length;i+=4) data.set([r,g,b,255],i);
  return {width:240,height:240,data};
}

test('a single 240px source generates byte-verified RU50 and baseline JPEG 4:4:4',async()=>{
  const result=await prepareBg02PictureComparison(solid(40,110,160),{jpegQuality:65});
  assert.equal(result.jpegQuality,65);
  assert.equal(result.ru50.bytes.length,29904);
  assert.equal(inspectRu50(result.ru50.bytes).width,240);
  assert.ok(result.jpeg.bytes.length>100);
  assert.equal(validateBg02Jpeg(result.jpeg.bytes).is444,true);
  assert.equal(validateBg02Jpeg(result.jpeg.bytes).width,240);
  assert.equal(validateBg02Jpeg(result.jpeg.bytes).height,240);
  assert.ok(result.jpeg.bytes.length < result.ru50.bytes.length,
    'simple solid still must benefit from variable JPEG compression');
  const pixels=result.ru50.pixels;
  assert.equal(pixels.width,240);
  assert.equal(pixels.height,240);
  for(const channel of [0,1,2]) {
    assert.ok(Math.abs(pixels.data[channel]-[40,110,160][channel])<=15);
  }
});

test('ETC2 preview decoder rejects modes the browser encoder cannot emit',()=>{
  assert.throws(()=>decodeEtc2IndividualRgb(Uint8Array.of(1),240,240));
  const bytes=new Uint8Array(8);
  bytes[3]=2; // ETC differential bit
  assert.throws(()=>decodeEtc2IndividualRgb(bytes,4,4),/individual mode/);
});

test('measured JPEG bytes produce exact format-aware storage estimates',()=>{
  const jpeg=estimatePictureStorage({
    bg02:true,format:'jpeg444',encodedBytes:7231,availableBytes:16384,
  });
  assert.equal(jpeg.encodedBytes,7231);
  assert.equal(jpeg.transferredBytes,7235);
  assert.equal(jpeg.allocationHint,8192);
  assert.equal(jpeg.freeAfterHint,8192);
  assert.equal(jpeg.fits,true);
  assert.equal(estimatePictureStorage({
    bg02:true,format:'jpeg444',encodedBytes:null,
  }),null);
  assert.equal(estimatePictureStorage({bg02:true}).encodedBytes,29904);
});

test('experimental JPEG is only eligible for exact V1.5 plus algorithm 4',()=>{
  const expected={name:'BG02',hardware:'LJ733_MB_V1.5',
    protocolMode:'fitpro',dialAlgorithm:4};
  const prepared={width:240,height:240,format:'jpeg444'};
  const known=resolveBadgeProfile(expected);
  assert.equal(known.jpegExperimentSupported,true);
  assert.equal(imageMatchesBadge(prepared,known,expected),true);
  for(const snap of [
    {...expected,dialAlgorithm:0},
    {...expected,hardware:'LJ733_MB_V1.1'},
    {...expected,protocolMode:'baji'},
  ]) {
    assert.equal(imageMatchesBadge(prepared,resolveBadgeProfile(snap),snap),false);
  }
  const plain={width:240,height:240,format:'ru50'};
  assert.equal(imageMatchesBadge(plain,known,expected),true);
});
