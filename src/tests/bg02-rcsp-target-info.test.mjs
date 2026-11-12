import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRcspTargetInfoRequest, Bg02RcspAssembler,
  parseMatchingTargetInfo, probeBg02RcspTargetInfo,
} from '../js/bg02-rcsp-target-info.js';
import { JIELI_OTA } from '../js/jieli-ota.js';

test('JieLi target-info request uses documented flags/opcode/BE16 packet envelope',()=>{
  const request = buildRcspTargetInfoRequest();
  assert.deepEqual([...request],[
    0xfe,0xdc,0xba,0xc0,0x03,0x00,0x06,
    0x00,0xff,0xff,0xff,0xff,0x00,0xef,
  ]);
  assert.throws(()=>buildRcspTargetInfoRequest(256));
});

test('RCSP response parser handles fragmented and coalesced packets',()=>{
  const stream = new Bg02RcspAssembler();
  const reply = Uint8Array.of(0xfe,0xdc,0xba,0x00,0x03,0x00,0x05,
    0x00,0x00,0x11,0x22,0x33,0xef);
  assert.deepEqual(stream.push(reply.slice(0,5)),[]);
  assert.deepEqual(stream.push(reply.slice(5,9)),[]);
  const frames=stream.push(reply.slice(9));
  assert.equal(frames.length,1);
  assert.equal(parseMatchingTargetInfo(frames[0],0).status,0);
  assert.equal(parseMatchingTargetInfo(frames[0],0).payloadLength,3);
  assert.equal(parseMatchingTargetInfo(frames[0],1),null);
  const next=stream.push(Uint8Array.of(...reply,...reply));
  assert.equal(next.length,2);
  assert.equal(parseMatchingTargetInfo({...frames[0], flags:0xc0},0),null);
});

test('identity probe sends exactly one read-only RCSP command and cleans up notify',async()=>{
  const calls=[];
  let handler;
  let target;
  const notify={
    properties:{notify:true},
    async startNotifications(){calls.push('start');return this},
    addEventListener(event,fn){assert.equal(event,'characteristicvaluechanged');
      handler=fn;calls.push('on');},
    removeEventListener(event,fn){assert.equal(fn,handler);calls.push('off');},
    async stopNotifications(){calls.push('stop')},
  };
  const write={
    properties:{writeWithoutResponse:true},
    async writeValueWithoutResponse(packet){
      calls.push('write');
      assert.deepEqual([...packet], [...buildRcspTargetInfoRequest()]);
      const reply=Uint8Array.of(0xfe,0xdc,0xba,0x00,0x03,0x00,0x04,
        0x00,0x00,0x66,0x77,0xef);
      queueMicrotask(()=>{
        const copied = new Uint8Array(reply);
        handler({target:{value:new DataView(copied.buffer,0,copied.length)}});
      });
    },
  };
  const server={
    connected:true,
    async getPrimaryService(uuid){
      assert.equal(uuid,JIELI_OTA.SERVICE);
      return {async getCharacteristic(uuid){
        if(uuid===JIELI_OTA.WRITE)return write;
        if(uuid===JIELI_OTA.NOTIFY)return notify;
        throw Error('unexpected characteristic');
      }};
    },
  };
  const result=await probeBg02RcspTargetInfo(server,{timeoutMs:1000});
  assert.equal(result.responseReceived,true);
  assert.equal(result.status,0);
  assert.equal(result.payloadLength,2);
  assert.equal(result.authConfirmed,false);
  assert.equal(result.fileListingConfirmed,false);
  assert.deepEqual(calls,['start','on','write','off','stop']);
});

test('RCSP without target response returns timeout; never sends a second command',async()=>{
  let writes=0,stopped=0;
  const server={
    connected:true,
    async getPrimaryService(){
      return {async getCharacteristic(uuid){
        if(uuid===JIELI_OTA.WRITE){
          return {properties:{writeWithoutResponse:true},
            async writeValueWithoutResponse(){writes++}};
        }
        return {properties:{notify:true},
          async startNotifications(){},
          addEventListener(){},
          removeEventListener(){},
          async stopNotifications(){stopped++}};
      }};
    },
  };
  const result=await probeBg02RcspTargetInfo(server,{timeoutMs:1000});
  assert.equal(result.timedOut,true);
  assert.equal(result.fileListingConfirmed,false);
  assert.deepEqual(result.rxDiagnostics,{
    notifications:0,bytes:0,rcspFrames:0,unmatchedFrames:0,
  });
  assert.match(result.notes,/No AE02 notifications/i);
  assert.equal(writes,1);
  assert.equal(stopped,1);
});

test('unmatched RCSP notification is distinguishable from silent AE02 timeout',async()=>{
  let handler;
  let writeCount=0;
  const unrelated=Uint8Array.of(
    0xfe,0xdc,0xba,0x00,0x07,0x00,0x02,0x00,0x00,0xef,
  );
  const notify={
    properties:{notify:true},
    async startNotifications(){},
    addEventListener(_name,fn){handler=fn},
    removeEventListener(){},
    async stopNotifications(){},
  };
  const write={
    properties:{writeWithoutResponse:true},
    async writeValueWithoutResponse(){
      writeCount++;
      queueMicrotask(()=>handler({target:{
        value:new DataView(unrelated.buffer,unrelated.byteOffset,unrelated.byteLength),
      }}));
    },
  };
  const server={connected:true,async getPrimaryService(){
    return {async getCharacteristic(uuid){
      return uuid===JIELI_OTA.WRITE?write:notify;
    }};
  }};
  const result=await probeBg02RcspTargetInfo(server,{timeoutMs:1000});
  assert.equal(result.timedOut,true);
  assert.equal(writeCount,1);
  assert.deepEqual(result.rxDiagnostics,{
    notifications:1,bytes:unrelated.length,rcspFrames:1,unmatchedFrames:1,
  });
  assert.match(result.notes,/none matching/i);
});
