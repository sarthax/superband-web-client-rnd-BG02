import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeBg02MediaTransport, mediaTelemetryDiff,
} from '../js/bg02-media-capabilities.js';
import { JIELI_OTA, listGattSummary } from '../js/jieli-ota.js';

test('GATT probe discovers AE00/AE01/AE02 without sending even one byte', async () => {
  const operations = [];
  const server = {
    connected: true,
    async getPrimaryService(uuid) {
      operations.push('getPrimaryService ' + uuid);
      assert.equal(uuid, JIELI_OTA.SERVICE);
      return {
        async getCharacteristics() {
          operations.push('getCharacteristics');
          return [
            { uuid: JIELI_OTA.WRITE, properties: { write: true } },
            { uuid: JIELI_OTA.NOTIFY, properties: { notify: true } },
          ];
        },
      };
    },
  };
  const result = await probeBg02MediaTransport(server);
  assert.equal(result.rcspService, 'ae00-rcsp-transport-candidate');
  assert.equal(result.fileListingConfirmed, false);
  assert.equal(result.ae01Visible, true);
  assert.equal(result.ae02Visible, true);
  assert.deepEqual(operations, [
    'getPrimaryService ' + JIELI_OTA.SERVICE, 'getCharacteristics',
  ]);
});

test('absent AE00 service never becomes a false proof of absent file management',async()=>{
  const server = {
    connected:true,
    async getPrimaryService() {
      throw Object.assign(new Error('Not found'),{name:'NotFoundError'});
    },
  };
  const result=await probeBg02MediaTransport(server);
  assert.equal(result.ae00Visible,false);
  assert.equal(result.fileListingConfirmed,false);
  assert.match(result.notes,/does not prove/i);
});

test('browser GATT permission failure means unknown, not no RCSP',async()=>{
  const server={
    connected:true,
    async getPrimaryService() {
      throw Object.assign(new Error('blocked'),{name:'SecurityError'});
    },
  };
  const result=await probeBg02MediaTransport(server);
  assert.equal(result.rcspService,'unknown');
  assert.equal(result.ae00Visible,null);
});

test('service with missing writable/notify pair is not a complete RCSP transport',async()=>{
  const result=await probeBg02MediaTransport({
    connected:true,
    async getPrimaryService() {
      return {async getCharacteristics(){
        return [{uuid:JIELI_OTA.NOTIFY,properties:{notify:true}}];
      }};
    },
  });
  assert.equal(result.rcspService,'ae00-incomplete-transport');
  assert.equal(result.ae01Visible,false);
  assert.equal(result.fileListingConfirmed,false);
});

test('metadata delta never claims to enumerate device files',()=>{
  const old={candidateCount:2,freeBytes:163840};
  const newer={candidateCount:3,freeBytes:155648};
  assert.deepEqual(mediaTelemetryDiff(old,newer),{
    countDelta:1,freeBytesDelta:-8192,candidateCountMeaningVerified:false,
  });
  assert.equal(mediaTelemetryDiff(old,{candidateCount:null,freeBytes:1000}),null);
});

test('disconnected probe does not discover any GATT service',async()=>{
  await assert.rejects(
    probeBg02MediaTransport({connected:false, getPrimaryService(){throw Error('should not call')}}),
    /connected/i,
  );
});

test('generic GATT display recognizes inherited WebIDL characteristic flags',async()=>{
  // Chrome exposes Bluetooth characteristic flags via prototype getters.
  // Object.entries(properties) would incorrectly show [] for every property.
  const props=Object.create({write:true,notify:true});
  assert.deepEqual(Object.entries(props),[]);
  const svc={
    uuid:JIELI_OTA.SERVICE,
    async getCharacteristics(){
      return [{uuid:JIELI_OTA.WRITE,properties:props}];
    },
  };
  const server={async getPrimaryServices(){return [svc]}};
  const rows=await listGattSummary(server);
  assert.deepEqual(rows[0].characteristics[0].properties,['write','notify']);
});
