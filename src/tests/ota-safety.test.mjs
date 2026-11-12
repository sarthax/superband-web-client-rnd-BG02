import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_OTA_FLASH_QUALIFIED,
  BROWSER_OTA_BLOCK_REASON,
  assertBrowserOtaFlashQualified,
} from '../js/ota-safety.js';

test('all unqualified browser OTA actions fail closed before connecting to AE00',()=>{
  assert.equal(BROWSER_OTA_FLASH_QUALIFIED,false);
  assert.match(BROWSER_OTA_BLOCK_REASON,/disabled/i);
  assert.match(BROWSER_OTA_BLOCK_REASON,/V1\.5/i);
  assert.throws(()=>assertBrowserOtaFlashQualified(),/disabled/i);
  assert.throws(()=>assertBrowserOtaFlashQualified({
    hardware:'LJ733_MB_V1.5',
    firmware:'V35922',
    fileName:'V32399_DG01_SUPERBAND.zip',
  }),/disabled/i);
});
