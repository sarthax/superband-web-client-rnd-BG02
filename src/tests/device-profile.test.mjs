import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBadgeProfile, imageMatchesBadge, needsFreshPictureSelection } from '../js/device-profile.js';

test('BG02 V1.5 always defaults to 240x240 RU50 without querying dial-info', () => {
  const profile = resolveBadgeProfile({
    name: 'BG02', hardware: 'LJ733_MB_V1.5', firmware: 'V35922',
    protocolMode: 'fitpro',
  });
  assert.equal(profile.id, 'bg02');
  assert.equal(profile.width, 240);
  assert.equal(profile.height, 240);
  assert.equal(profile.format, 'ru50');
  assert.equal(profile.fileAccept, 'image/*,.ru50');
  assert.equal(profile.chooseLabel, 'Choose photo');
  assert.match(profile.formatHelp, /converted automatically/);
  assert.equal(profile.fixedSize, true);
  assert.equal(profile.showMediaLibrary, false);
  assert.equal(profile.showBajiOptions, false);
  assert.equal(imageMatchesBadge({ format: 'rgb565', width: 240, height: 240 }, profile, { protocolMode: 'fitpro' }), false);
  assert.equal(imageMatchesBadge({ format: 'ru50', width: 240, height: 240 }, profile, { protocolMode: 'fitpro' }), true);
});

test('BG02 detected from hardware even when advertised name is blank', () => {
  const profile = resolveBadgeProfile({ hardware: 'LJ733_MB_V1.5', protocolMode: 'fitpro', dialWidth: 360, dialHeight: 360 });
  assert.equal(profile.id, 'bg02');
  assert.equal(profile.width, 240);
  assert.equal(profile.height, 240);
});

test('BJ/DG generic FitPro retains RGB565 and manual dimensions', () => {
  const profile = resolveBadgeProfile({ name: 'DG01', protocolMode: 'fitpro' });
  assert.equal(profile.format, 'rgb565');
  assert.equal(profile.width, 360);
  assert.equal(profile.height, 360);
  assert.equal(profile.fixedSize, false);
  assert.equal(profile.fileAccept, 'image/*');
  assert.equal(imageMatchesBadge({ format: 'ru50', width: 240, height: 240 }, profile), false);
});

test('Reported non-BG02 dial size is respected, JPEG algorithm uses JPEG', () => {
  const profile = resolveBadgeProfile({
    name: 'BJ-1', protocolMode: 'fitpro',
    dialWidth: 320, dialHeight: 240, dialAlgorithm: 4,
  });
  assert.equal(profile.width, 320);
  assert.equal(profile.height, 240);
  assert.equal(profile.format, 'jpeg444');
});

test('Baji media controls are visible and JPEG stays the image codec', () => {
  const profile = resolveBadgeProfile({ name: 'Some Baji badge', protocolMode: 'baji' });
  assert.equal(profile.format, 'jpeg444');
  assert.equal(profile.showMediaLibrary, true);
  assert.equal(profile.showBajiOptions, true);
});

test('Unknown/unconnected uses safe generic fallback until identification', () => {
  const profile = resolveBadgeProfile({});
  assert.equal(profile.width, 360);
  assert.equal(profile.height, 360);
  assert.equal(profile.format, 'rgb565');
  assert.equal(imageMatchesBadge(null, profile), false);
});

test('active badge change requires an explicit new picture selection', () => {
  assert.equal(needsFreshPictureSelection(null, 'badge-A'), true);
  assert.equal(needsFreshPictureSelection('badge-A', 'badge-B'), true);
  assert.equal(needsFreshPictureSelection('badge-A', null), true);
});

test('device metadata refresh for the same badge preserves selected picture', () => {
  assert.equal(needsFreshPictureSelection('badge-A', 'badge-A'), false);
  assert.equal(needsFreshPictureSelection(null, null), false);
});
