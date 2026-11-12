import test from 'node:test';
import assert from 'node:assert/strict';
import { createBg02Project, readBg02Project } from '../js/editor-project.js';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const source=(name, bytes=Uint8Array.of(1,2,3,4))=>({
  name,type:'image/png',async arrayBuffer(){
    return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  },
});
const crop={zoom:1.35,offsetX:20,offsetY:-12};

test('picture project ZIP roundtrip embeds original source and exact crop/quality',async()=>{
  const bytes=await createBg02Project(source('my photo.png'),'picture',{
    codec:'jpeg444',jpegQuality:80,crop,
  });
  const project=readBg02Project(bytes);
  assert.equal(project.kind,'picture');
  assert.equal(project.sourceName,'my photo.png');
  assert.deepEqual([...project.sourceBytes],[1,2,3,4]);
  assert.deepEqual(project.state.crop,crop);
  assert.equal(project.state.jpegQuality,80);
  assert.deepEqual(Object.keys(unzipSync(bytes)).sort(),['project.json','source.bin']);
});

test('video/GIF project ZIP roundtrip preserves selected frames and overrides',async()=>{
  const state={
    start:1,end:4,seconds:5,fps:1,quality:'medium',fit:'cover',
    loop:false,gifUseFrames:true,gifHold:3,frameIndices:[0,2,7],
    crop:{sharedCrop:crop,frameCropOverrides:[[2,{zoom:2,offsetX:0,offsetY:3}]]},
  };
  const zip=await createBg02Project(source('movie.gif'),'video',state);
  const restored=readBg02Project(zip);
  assert.equal(restored.kind,'video');
  assert.deepEqual(restored.state,state);
});

test('rejects unknown ZIP files, invalid project options, and source size mismatch',async()=>{
  await assert.rejects(
    ()=>createBg02Project(source('x.png'),'picture',{
      codec:'jpeg444',jpegQuality:99,crop,
    }),/Invalid picture/i);
  assert.throws(()=>readBg02Project(Uint8Array.of(1,2,3)),/ZIP/i);
  const zip=zipSync({
    'project.json':strToU8(JSON.stringify({
      signature:'bg02-editor-project',version:1,kind:'picture',
      sourceName:'bad.png',sourceSize:999,state:{
        codec:'jpeg444',jpegQuality:80,crop,
      },
    })),
    'source.bin':Uint8Array.of(1,2,3),
  });
  assert.throws(()=>readBg02Project(zip),/Invalid BG02 project manifest/i);
  const untrusted=zipSync({
    'project.json':strToU8('{}'),
    'source.bin':Uint8Array.of(1),
    'unexpected.exe':Uint8Array.of(2),
  });
  assert.throws(()=>readBg02Project(untrusted),/Unsafe or unexpected/i);
});
