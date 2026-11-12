import { SuperBandClient, FileType, FunctionType } from './client.js';
import { prepareFileForBadge, loadImage, formatBytes, DEFAULT_DIAL } from './image.js';
import { inspectRu50, encodeImageDataRu50, looksLikeBg02 } from './ru50.js';
import { CircleCropEditor } from './circle-crop.js';
import { REPO_URL } from './protocol.js';
import { resolveBadgeProfile, imageMatchesBadge } from './device-profile.js';
import { bindAdvanced } from './advanced.js';
import { bindVideo } from './video-ui.js';
import { bindBg02Library } from './bg02-library-ui.js';
import { estimatePictureStorage } from './picture-size.js';
import { prepareBg02PictureComparison } from './picture-comparison.js';
import { encodeBaselineJpeg444 } from './jpeg444.js';
import { createBg02Project, readBg02Project } from './editor-project.js';
import {
  jpegAllocationSummary, jpegTargetAllocation, optimizeJpegAllocation,
} from './jpeg-allocation.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const client = new SuperBandClient();
let prepared = null;
let transferring = false;
let activeProfileKey = null;
let previewGeneration = 0;
let videoController = null;
let libraryController = null;
let pictureComparison = null;
let pictureComparisonGeneration = 0;
let pictureComparing = false;
const cropper = new CircleCropEditor({
  canvas: $('#cropCanvas'),
  zoomInput: $('#cropZoom'),
  resetButton: $('#cropReset'),
  onChange: ({zoom}) => {
    $('#cropZoomValue').textContent = zoom + '%';
    // A JPEG/RU50 comparison must always represent the EXACT current crop.
    // Framing adjustments invalidate encoded bytes; no stale uploads.
    if (pictureComparison || pictureComparing || prepared?.source === 'comparison') {
      invalidatePictureComparison('Crop changed. Reconvert to compare the current framing.');
    }
    renderPictureSize();
  },
});
function showCropper() {
  $('#dialPreview').hidden = true;
  $('#dialPlaceholder').hidden = true;
  $('#cropCanvas').hidden = false;
  $('#cropControls').hidden = false;
  $('#dial').classList.add('crop-active','round');
}
function hideCropper() {
  $('#cropCanvas').hidden = true;
  $('#cropControls').hidden = true;
  $('#dial').classList.remove('crop-active');
}


function setPill(el, text, state = '') {
  el.textContent = text;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

function setUploadStatus(message, state = '') {
  const el = $('#pushStatus');
  el.textContent = message;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

/**
 * Picture QOL: exact output byte size and conservative badge allocation hint.
 * RU50 is fixed-size (29,904 B) regardless of original picture or crop;
 * the UI never claims an exact physical flash block size.
 */


function downloadOfflineBytes(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function savePictureProject() {
  const file = $('#imageInput').files?.[0];
  if (!file || !cropper.image || !resolveBadgeProfile(client.getSnapshot()).bg02)
    throw new Error('Choose a BG02 source photo before saving a project');
  if (transferring || pictureComparing) throw new Error('Finish current operation');
  const bytes = await createBg02Project(file, 'picture', {
    codec: pictureCodec(),
    jpegQuality: Number($('#pictureJpegQuality').value),
    crop: cropper.snapshot(),
  });
  const base = file.name.replace(/\.[^.]+$/, '') || 'badge-photo';
  downloadOfflineBytes(bytes, base + '.bg02-project.zip', 'application/zip');
}

async function openPictureProject(zipFile) {
  if (transferring || pictureComparing || client.anyTransferring)
    throw new Error('Finish the active transfer before opening a project');
  const record = readBg02Project(new Uint8Array(await zipFile.arrayBuffer()));
  if (record.kind !== 'picture') throw new Error('This ZIP contains a video/GIF project');
  if (!resolveBadgeProfile(client.getSnapshot()).bg02)
    throw new Error('Connect BG02 before opening a picture project');
  const sourceFile = new File([record.sourceBytes], record.sourceName, {
    type: record.sourceMime,
  });
  const transfer = new DataTransfer();
  transfer.items.add(sourceFile);
  $('#imageInput').files = transfer.files;
  await rebuildPreview();
  if (!cropper.image || prepared?.source !== 'crop')
    throw new Error('The project image could not be loaded');
  cropper.restore(record.state.crop);
  $('#pictureCodec').value = record.state.codec;
  $('#pictureJpegQuality').value = String(record.state.jpegQuality);
  invalidatePictureComparison('Project restored. Optimize or compare before uploading.');
  updatePushChecklist();
  setUploadStatus('Project restored locally. No badge data was sent.', 'ok');
}

function downloadPreparedPicture() {
  if (!prepared?.bytes?.length) throw new Error('Optimize or compare the image first');
  const base = ($('#imageInput').files?.[0]?.name || 'BG02').replace(/\.[^.]+$/, '');
  const jpeg = prepared.format === 'jpeg444';
  downloadOfflineBytes(prepared.bytes, base + '-BG02.' + (jpeg ? 'jpg' : 'ru50'),
    jpeg ? 'image/jpeg' : 'application/octet-stream');
}

function pictureCodec() {
  return $('#pictureCodec').value === 'jpeg444' ? 'jpeg444' : 'ru50';
}

function pictureCodecEligible(snapshot = client.getSnapshot()) {
  return resolveBadgeProfile(snapshot).bg02 &&
    (prepared?.source === 'crop' || prepared?.source === 'comparison');
}

function updatePictureCodecControls(snapshot = client.getSnapshot()) {
  const enabled = pictureCodecEligible(snapshot);
  $('#pictureCodecControls').hidden = !enabled;
  $('#pictureJpegQualityWrap').hidden = pictureCodec() !== 'jpeg444';
  $('#pictureAllocationOptimizer').hidden = !enabled || pictureCodec() !== 'jpeg444';
  $('#pictureJpegQualityLabel').textContent = $('#pictureJpegQuality').value;
  $('#pictureCompareBuild').disabled = !enabled || pictureComparing ||
    transferring || client.anyTransferring;
  $('#pictureQuickOptimize').hidden = !enabled || pictureCodec() !== 'jpeg444';
  $('#pictureQuickOptimize').disabled = !enabled || pictureComparing ||
    transferring || client.anyTransferring;
  $('#pictureCodec').disabled = pictureComparing || transferring ||
    client.anyTransferring;
  $('#pictureJpegQuality').disabled = pictureComparing || transferring ||
    client.anyTransferring;
  for (const id of ['pictureOptimizeSmaller', 'pictureOptimizeCurrent',
    'pictureOptimizeLarger']) {
    $('#' + id).disabled = !enabled || pictureComparing ||
      transferring || client.anyTransferring;
  }
  $('#pictureRu50Pane').dataset.selected = String(pictureCodec() === 'ru50');
  $('#pictureJpegPane').dataset.selected = String(pictureCodec() === 'jpeg444');
}

function invalidatePictureComparison(reason = 'Picture options changed. Compare again before uploading.') {
  pictureComparisonGeneration++;
  pictureComparison = null;
  $('#pictureComparison').hidden = true;
  $('#pictureComparePrompt').textContent = reason;
  if (prepared?.source === 'comparison') {
    prepared = { ...prepared, source: 'crop', bytes: null, format: 'ru50' };
  }
  // Keep the original photo and crop. No badge operation is performed.
  updatePictureCodecControls();
  renderPictureSize();
  updatePushChecklist();
}

function selectPictureCodec() {
  updatePictureCodecControls();
  if (pictureComparison && prepared?.source === 'comparison') {
    const selected = pictureCodec() === 'jpeg444'
      ? pictureComparison.jpeg : pictureComparison.ru50;
    prepared = { ...prepared, format: selected.format, bytes: selected.bytes };
    $('#pictureComparePrompt').textContent =
      'Selected ' + (selected.format === 'jpeg444' ? 'JPEG 4:4:4' : 'RU50') +
      ' · ' + formatBytes(selected.bytes.length) + ' prepared for upload.';
    setUploadStatus(selected.format === 'jpeg444'
      ? 'JPEG ready. Review the image preview, then upload when you choose.'
      : 'RU50 selected. The previewed bytes are ready to upload.', 'ok');
  }
  renderPictureSize();
  updatePushChecklist();
}

/** Render 240px pixels in the exact output crop orientation. */
function drawPicturePixels(canvas, pixels) {
  canvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height),
    0, 0,
  );
}

async function comparePicture(allocationShift = null) {
  if (!pictureCodecEligible() || pictureComparing ||
      transferring || client.anyTransferring) return;
  const file = $('#imageInput').files?.[0];
  const before = client.getSnapshot();
  // Capture the currently measured JPEG *before* invalidation. If there is
  // no comparison yet, measure the current quality from the crop once.
  const referenceJpeg = pictureComparison?.jpeg?.bytes ?? null;
  invalidatePictureComparison('Encoding the latest crop…');
  const request = ++pictureComparisonGeneration;
  const jpegQuality = Number($('#pictureJpegQuality').value);
  pictureComparing = true;
  $('#pictureComparePrompt').textContent =
    allocationShift == null
      ? 'Encoding RU50 and JPEG at the current crop…'
      : 'Finding highest JPEG quality within the selected 8 KiB allocation…';
  updatePushChecklist();
  try {
    const sourcePixels = cropper.getImageData(240);
    let optimized = null;
    if (allocationShift !== null) {
      const baselineBytes = referenceJpeg ??
        encodeBaselineJpeg444(sourcePixels, { quality: jpegQuality });
      const targetBytes = jpegTargetAllocation(baselineBytes.length, allocationShift);
      $('#pictureOptimizeInfo').textContent =
        'Target ' + formatBytes(targetBytes) +
        ' allocation: checking JPEG qualities 90 down to 35…';
      optimized = await optimizeJpegAllocation(sourcePixels, targetBytes, {
        checkCurrent: () => request === pictureComparisonGeneration &&
          file === $('#imageInput').files?.[0] &&
          before.sessionId === client.getSnapshot().sessionId,
        onTrial: ({ quality, trials }) => {
          if (trials % 3 === 1)
            $('#pictureOptimizeInfo').textContent =
              'Target ' + formatBytes(targetBytes) +
              ' · trying quality ' + quality + ' (' + trials + ' encodes)…';
        },
      });
      if (!optimized.fits) {
        throw new Error('No JPEG quality 35–90 fits ' +
          formatBytes(targetBytes) + ' allocation. Smallest tested JPEG is ' +
          formatBytes(optimized.minimumSize.encodedBytes) +
          '. Choose a larger block or a less complex crop.');
      }
    }
    const result = await prepareBg02PictureComparison(sourcePixels, {
      jpegQuality: optimized?.quality ?? jpegQuality,
      preparedJpegBytes: optimized?.bytes ?? null,
    });
    if (request !== pictureComparisonGeneration ||
        file !== $('#imageInput').files?.[0] ||
        before.sessionId !== client.getSnapshot().sessionId) return;
    // Decode the EXACT byte stream returned by the JPEG encoder rather than
    // previewing a second uncompressed canvas. A failed decode cannot upload.
    const bitmap = await createImageBitmap(
      new Blob([result.jpeg.bytes], { type: 'image/jpeg' }),
    );
    if (request !== pictureComparisonGeneration ||
        file !== $('#imageInput').files?.[0] ||
        before.sessionId !== client.getSnapshot().sessionId) {
      bitmap.close();
      return;
    }
    try {
      if (bitmap.width !== 240 || bitmap.height !== 240)
        throw new Error('Encoded JPEG did not decode at 240×240');
      drawPicturePixels($('#pictureCompareSource'), result.sourcePixels);
      drawPicturePixels($('#pictureCompareRu50'), result.ru50.pixels);
      const ctx = $('#pictureCompareJpeg').getContext('2d');
      ctx.clearRect(0, 0, 240, 240);
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    pictureComparison = result;
    if (optimized) {
      // Set the slider programmatically: the JPEG bytes used for preview and
      // upload are the exact tested bytes, not a second recompression.
      $('#pictureJpegQuality').value = String(optimized.quality);
      $('#pictureJpegQualityLabel').textContent = String(optimized.quality);
      $('#pictureCodec').value = 'jpeg444';
    }
    const allocation = jpegAllocationSummary(result.jpeg.bytes.length);
    $('#pictureOptimizeInfo').textContent =
      'JPEG quality ' + result.jpegQuality + ' · ' +
      formatBytes(result.jpeg.bytes.length) + ' file + 4 B wrapper · ' +
      formatBytes(allocation.allocationBytes) + ' block · ' +
      formatBytes(allocation.headroomBytes) + ' unused within this allocation' +
      (optimized ? ' · highest fitting quality (' + optimized.trials + ' tested)' : '');
    $('#pictureRu50Bytes').textContent =
      formatBytes(result.ru50.bytes.length) + ' · ~' +
      formatBytes(estimatePictureStorage({
        bg02:true, format:'ru50', encodedBytes:result.ru50.bytes.length,
      }).allocationHint) + ' allocation';
    $('#pictureJpegBytes').textContent =
      formatBytes(result.jpeg.bytes.length) + ' · ~' +
      formatBytes(estimatePictureStorage({
        bg02:true, format:'jpeg444', encodedBytes:result.jpeg.bytes.length,
      }).allocationHint) + ' allocation';
    const saving = 100 * (1 - result.jpeg.bytes.length / result.ru50.bytes.length);
    $('#pictureCompareSavings').textContent =
      'JPEG ' + (saving >= 0 ? 'saves ' + saving.toFixed(1) + '%'
        : 'uses ' + (-saving).toFixed(1) + '% more') +
      ' encoded bytes at quality ' + result.jpegQuality +
      '. Compare the fine edges and text before choosing.';
    $('#pictureComparison').hidden = false;
    $('#pictureCompareStatus').textContent =
      'Previews decode the actual encoded data. JPEG was hardware-tested on BG02 V1.5; visual results still vary by image. No upload has occurred.';
    // Mark the cache ready and default to whichever format user selected.
    prepared = { ...prepared, source: 'comparison' };
    selectPictureCodec();
  } catch (e) {
    if (request !== pictureComparisonGeneration) return;
    pictureComparison = null;
    $('#pictureComparison').hidden = true;
    $('#pictureComparePrompt').textContent = 'Comparison failed: ' + e.message;
    setUploadStatus('Picture comparison failed: ' + e.message, 'err');
    log({ msg:'BG02 picture compare: ' + e.message, level:'warn' });
  } finally {
    pictureComparing = false;
    updatePictureCodecControls();
    updatePushChecklist();
  }
}

function renderPictureSize(snapshot = client.getSnapshot()) {
  const box = $('#pictureSizePreview');
  const file = $('#imageInput').files?.[0];
  const profile = resolveBadgeProfile(snapshot);
  if (!file || !prepared) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const selectedFormat = profile.bg02 && prepared.source !== 'encoded'
    ? pictureCodec() : prepared.format;
  const measuredBytes = profile.bg02 && prepared.source !== 'encoded'
    ? (pictureComparison
      ? (selectedFormat === 'jpeg444' ? pictureComparison.jpeg : pictureComparison.ru50).bytes.length
      : null)
    : prepared.bytes?.length ?? null;
  const estimated = estimatePictureStorage({
    bg02: profile.bg02,
    format: selectedFormat,
    encodedBytes: measuredBytes,
    sourceBytes: file.size,
    availableBytes: snapshot?.freeStorage ?? null,
  });
  const dims = prepared.sourceWidth && prepared.sourceHeight
    ? ' · ' + prepared.sourceWidth + '×' + prepared.sourceHeight + ' px'
    : '';
  $('#pictureSourceSize').textContent = formatBytes(file.size) + dims;
  $('#pictureEncodedSize').textContent = estimated
    ? formatBytes(estimated.encodedBytes) +
      (profile.bg02
        ? (selectedFormat === 'jpeg444' ? ' · JPEG 4:4:4 (measured)' :
          ' · RU50/ETC2 240×240 (fixed)')
        : ' · encoded')
    : 'Not encoded — select Convert & compare';
  $('#pictureAllocation').textContent = estimated?.allocationHint != null
    ? '~' + formatBytes(estimated.allocationHint) + ' (8 KiB-rounded estimate)'
    : 'Not established for this model';
  const free = $('#pictureFreeSpace');
  free.classList.remove('picture-too-large');
  free.textContent = estimated?.availableBytes != null
    ? '~' + formatBytes(estimated.availableBytes)
    : 'Not reported';
  if (estimated?.fits === false) free.classList.add('picture-too-large');
  $('#pictureSpaceHint').textContent = profile.bg02
    ? selectedFormat === 'jpeg444' && !pictureComparison
      ? 'JPEG needs a current image optimization or comparison; ' +
        'file size cannot be estimated before encoding.'
      : estimated?.fits === false
        ? 'Estimated image allocation exceeds the last reported free space. ' +
          'Please free storage before uploading.'
        : estimated?.freeAfterHint != null
          ? 'Estimated free after upload: ~' +
            formatBytes(estimated.freeAfterHint) +
            '. The 8 KiB allocation rounding is empirical, not proven flash geometry.'
          : 'Connect BG02 to compare your encoded size with the reported free space. ' +
            'Allocation rounding is only an estimate.'
    : 'Estimated storage allocation is available only for BG02; ' +
      'the selected image has not changed.';
}


function syncConnectionChrome() {
  const n = client.sessionCount;
  const on = n > 0 && client.connected;
  $$('[data-need-conn]').forEach((b) => {
    b.disabled = !on;
  });
  // No browser OTA firmware transfer has been qualified. This guard is
  // universal, even if a device/session event re-enables data-need-conn.
  $('#btnOtaFlash').disabled = true;
  $('#btnOtaFlashPicker').disabled = true;
  $('#otaConfirmRisk').disabled = true;

  // Always allow adding another device while Web Bluetooth works
  $('#btnConnect').hidden = false;
  $('#btnConnectAny').hidden = false;
  $('#btnConnect').textContent = n ? 'Add badge' : 'Connect badge';
  $('#btnConnectAny').textContent = n ? 'Add other' : 'Other device';
  $('#btnAddBadge').hidden = n === 0;
  $('#btnDisconnect').hidden = n === 0;
  $('#btnDisconnectAll').hidden = n < 2;
  $('#btnPushAll').hidden = n < 2 || resolveBadgeProfile(client.getSnapshot()).bg02;

  const label =
    n === 0
      ? 'Disconnected'
      : n === 1
        ? `Connected · ${client.name || 'badge'}`
        : `${n} badges · active ${client.name || '—'}`;
  setPill($('#connPill'), label, n ? 'ok' : '');
  $('#deviceGlance').hidden = !on;
  $('#deviceRail').hidden = n === 0;
  $('#deviceCount').textContent = String(n);
  updatePushChecklist();
}

function renderDeviceChips() {
  const box = $('#deviceChips');
  box.innerHTML = '';
  for (const s of client.sessions) {
    const chip = document.createElement('div');
    chip.className = 'device-chip' + (s.active ? ' active' : '');
    chip.dataset.id = s.id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'device-chip-main';
    main.title = 'Make active';
    const title = s.name || 'Badge';
    const sub = [s.firmware, s.battery != null ? `${s.battery}%` : null].filter(Boolean).join(' · ');
    main.innerHTML = `<span class="chip-name"></span><span class="chip-sub"></span>`;
    main.querySelector('.chip-name').textContent = title + (s.active ? ' · active' : '');
    main.querySelector('.chip-sub').textContent = sub || s.id.slice(0, 8);
    main.addEventListener('click', () => {
      try {
        client.setActive(s.id);
        toast(`Active: ${client.name || s.id}`, 'ok');
        if (client.getSnapshot().protocolMode === 'baji') {
          client.requestMediaList().catch((e) => {
            log({ msg: `Media list: ${e.message}`, level: 'warn' });
          });
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'device-chip-x';
    x.title = 'Disconnect this badge';
    x.textContent = '×';
    x.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await client.disconnect(s.id);
        toast('Badge disconnected', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    chip.appendChild(main);
    chip.appendChild(x);
    box.appendChild(chip);
  }
}

function log({ msg, level = 'info' }) {
  const box = $('#activityLog');
  const row = document.createElement('div');
  row.className = `log-line ${level}`;
  row.innerHTML = `<span class="t"></span><span class="m"></span>`;
  row.querySelector('.t').textContent = new Date().toLocaleTimeString();
  row.querySelector('.m').textContent = msg;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.hidden = true;
    }, 280);
  }, 2800);
}

function fmtBig(n) {
  if (n == null) return '—';
  const v = typeof n === 'bigint' ? Number(n) : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return formatBytes(v);
}

function dash(v) {
  return v == null || v === '' ? '—' : String(v);
}

/**
 * Update device-dependent defaults only when identity or reported display
 * geometry changes; preserve manual size changes for other badge families.
 * Never mark a previously prepared image compatible with a different badge.
 */
function applyBadgeProfile(snapshot = client.getSnapshot()) {
  const profile = resolveBadgeProfile(snapshot);
  const key = [
    snapshot?.sessionId || '-', profile.id, profile.width, profile.height,
    profile.format,
  ].join('|');
  const changed = key !== activeProfileKey;
  if (changed) {
    activeProfileKey = key;
    previewGeneration++;
    prepared = null;
    cropper.clear();
    hideCropper();
    $('#dialW').value = String(profile.width);
    $('#dialH').value = String(profile.height);
  }

  $('#dialW').disabled = profile.fixedSize;
  $('#dialH').disabled = profile.fixedSize;
  $('#dialWidthOption').hidden = profile.bg02;
  $('#dialHeightOption').hidden = profile.bg02;
  $('#dialWidthOption').title = profile.fixedSize ? 'Fixed for the BG02 display' : '';
  $('#dialHeightOption').title = profile.fixedSize ? 'Fixed for the BG02 display' : '';
  $('#imageInput').accept = profile.fileAccept;
  if (changed && !profile.bg02)
    invalidatePictureComparison('BG02 comparison unavailable on this device.');
  $('#btnPickImage').textContent = profile.chooseLabel;
  $('#imageFormatHelp').textContent = profile.formatLabel;
  $('#imageInputHint').textContent = profile.formatHelp;
  $('#mediaLibrarySection').hidden = !profile.showMediaLibrary;
  $('#roleOptions').hidden = !profile.showBajiOptions;
  $('#allocMediaOption').hidden = !profile.showBajiOptions;
  $('#roundMaskOption').hidden = profile.bg02;
  $('#btnPushAll').hidden = profile.bg02 || client.sessionCount < 2;
  $('#btnPush').textContent = profile.bg02 ? 'Upload picture' : 'Upload to badge';
  $('#otaPreset').disabled = profile.bg02;
  $('#btnOtaPrepare').disabled = profile.bg02;
  $('#otaCatVersion').disabled = profile.bg02;
  $('#otaCatName').disabled = profile.bg02;
  $('#btnOtaProbeCatalog').disabled = profile.bg02;

  // The presets in Advanced are for BJ-1/DG01, not our LJ733 V1.5.
  // Do not accidentally offer unrelated firmware flashing as a BG02 action.
  $('#btnOtaFlash').disabled = true;
  $('#btnOtaFlashPicker').disabled = true;
  $('#otaConfirmRisk').disabled = true;
  if (changed && profile.bg02) $('#otaConfirmRisk').checked = false;
  if (changed) {
    const file = $('#imageInput').files?.[0];
    if (file) {
      void rebuildPreview();
    } else {
      $('#dialPreview').hidden = true;
      $('#dialPlaceholder').hidden = false;
      $('#dialPlaceholder').textContent = 'Choose an image to preview';
      $('#imageMeta').textContent = 'No image selected.';
      setUploadStatus(client.connected
        ? 'Choose a picture to upload to this badge.'
        : 'Connect a badge, then choose a picture.');
    }
  }
  updatePushChecklist();
  videoController?.update(snapshot);
  libraryController?.update(snapshot);
}

function renderSnapshot(snap) {
  const s = snap || client.getSnapshot();
  applyBadgeProfile(s);
  renderPictureSize(s);
  const battery = s.battery == null ? '—' : `${s.battery}%`;

  const fields = {
    name: dash(s.name),
    model: dash(s.model),
    firmware: dash(s.firmware),
    hardware: dash(s.hardware),
    software: dash(s.software),
    manufacturer: dash(s.manufacturer),
    battery,
    protocol: dash(s.protocol),
    free: s.freeStorageSource === 'fitpro-0x20/4-provisional'
      ? `~${fmtBig(s.freeStorage)}` : fmtBig(s.freeStorage),
    cap: s.storageProbeSupported && s.storageCapacity == null
      ? 'Not reported' : fmtBig(s.storageCapacity),
  };

  for (const [key, val] of Object.entries(fields)) {
    $$('[data-field="' + key + '"]').forEach((el) => {
      el.textContent = val;
    });
  }

  const storageHint = s.freeStorageSource === 'fitpro-0x20/4-provisional'
    ? 'BG02 FitPro 0x20/4, read-only: second u32 is a candidate for free media bytes. Compare with SuperBand app.'
    : '';
  $$('[data-field="free"], [data-glance="free"]').forEach((el) => {
    el.title = storageHint;
  });

  const glance = {
    name: fields.name,
    model: fields.model,
    firmware: fields.firmware,
    battery: fields.battery,
    hardware: fields.hardware,
    free: fields.free,
  };
  for (const [key, val] of Object.entries(glance)) {
    const el = document.querySelector(`[data-glance="${key}"]`);
    if (el) el.textContent = val;
  }

  if (s.protocolMode === 'fitpro') {
    $('#mediaIdPill').textContent = 'FitPro dial31';
  } else if (s.mediaId != null) {
    $('#mediaIdPill').textContent = `Media ID ${s.mediaId}`;
  } else if (!s.connected) {
    $('#mediaIdPill').textContent = 'Media ID —';
  }
}

function updatePushChecklist() {
  const connected = client.connected;
  const profile = resolveBadgeProfile(client.getSnapshot());
  // For source photos on BG02 the exact bytes must already be previewed.
  // This prevents uploading a stale crop or silently bypassing JPEG quality.
  const imageReady = !!prepared &&
    !(profile.bg02 && prepared.source === 'crop');
  const idle = !transferring && !pictureComparing && !client.anyTransferring;
  const storageProbe = client.getSnapshot()?.storageProbeSupported;
  $('#btnRefreshStorage').disabled = !connected || !idle || !storageProbe;
  const map = { conn: connected, image: imageReady, idle };
  for (const [key, ok] of Object.entries(map)) {
    const li = document.querySelector(`[data-check="${key}"]`);
    if (!li) continue;
    li.dataset.ok = ok ? '1' : '0';
  }
  const compatible = imageMatchesBadge(prepared, profile, client.getSnapshot());
  const canPush = connected && imageReady && compatible && idle;
  $('#btnPush').disabled = !canPush;
  $('#btnPushAll').disabled = !(
    client.sessionCount >= 2 && canPush && !profile.bg02 &&
    prepared?.format !== 'ru50'
  );
  $('#pictureSaveProject').disabled = !idle || !cropper.image ||
    !profile.bg02 || prepared?.source === 'encoded';
  $('#pictureOpenProject').disabled = !idle;
  $('#pictureDownloadPrepared').disabled = !idle || !prepared?.bytes?.length ||
    !profile.bg02;
  $('#btnPickImage').disabled = !idle;
  $('#imageInput').disabled = !idle;
  $('#cropZoom').disabled = !idle;
  $('#cropReset').disabled = !idle;
  $('#cropCanvas').style.pointerEvents = idle ? 'auto' : 'none';
  updatePictureCodecControls();
}

function renderMediaList(items) {
  const box = $('#mediaList');
  if (!items?.length) {
    box.innerHTML =
      '<div class="empty">No media entries parsed (device may use a different list layout). Push still works.</div>';
    return;
  }
  box.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'media-item';
    row.innerHTML = `
      <div class="meta">
        <div class="title"></div>
        <div class="sub"></div>
      </div>
      <button class="danger" type="button">Delete</button>`;
    row.querySelector('.title').textContent = item.name || `Media ${item.mediaId}`;
    row.querySelector('.sub').textContent =
      `id=${item.mediaId} · ${formatBytes(item.fileSize)} · type=${item.fileType}`;
    row.querySelector('button').addEventListener('click', async () => {
      try {
        await client.deleteMedia(item.mediaId);
        toast(`Delete sent for ${item.mediaId}`, 'ok');
        await client.requestMediaList().catch(() => {});
      } catch (e) {
        toast(e.message, 'err');
        log({ msg: e.message, level: 'err' });
      }
    });
    box.appendChild(row);
  }
}

async function connect(acceptAll) {
  try {
    setPill($('#connPill'), 'Connecting…', 'busy');
    await client.connect({ acceptAll });
    syncConnectionChrome();
    renderDeviceChips();
    renderSnapshot();
    toast(
      client.sessionCount > 1
        ? `Added · ${client.sessionCount} badges connected`
        : 'Badge connected',
      'ok',
    );
    const snap = client.getSnapshot();
    if (snap.protocolMode === 'baji') {
      client.requestMediaList().catch((e) => {
        log({ msg: `Media list: ${e.message}`, level: 'warn' });
      });
    } else if (snap.protocolMode === 'fitpro') {
      log({ msg: 'FitPro badge — media library skipped (use Push for dial31 upload)', level: 'info' });
    }
    // applyBadgeProfile() already rebuilds the selected image on identity change.
  } catch (e) {
    syncConnectionChrome();
    renderDeviceChips();
    if (!client.sessionCount) {
      setPill($('#connPill'), 'Connect failed', 'err');
    }
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function rebuildPreview() {
  const token = ++previewGeneration;
  const file = $('#imageInput').files?.[0];
  // Choose tested JPEG only for a known matching board. RU50 remains the
  // compatibility fallback when dial algorithm and hardware are unknown.
  $('#pictureCodec').value =
    resolveBadgeProfile(client.getSnapshot()).jpegExperimentSupported
      ? 'jpeg444' : 'ru50';
  prepared = null;
  $('#pictureStorageDelta').textContent =
    'Actual storage change will appear after a successful picture upload, if available.';
  invalidatePictureComparison('Choose a crop, then compare RU50 with JPEG.');
  updatePushChecklist();
  hideCropper();
  setUploadStatus(file ? 'Preparing picture preview…' : 'Choose a picture to get started.');
  if (!file) {
    cropper.clear();
    $('#dialPreview').hidden = true;
    $('#dialPlaceholder').hidden = false;
    $('#dialPlaceholder').textContent = 'Choose a picture';
    $('#imageMeta').textContent = 'No image selected.';
    return;
  }

  const snap = client.getSnapshot();
  const profile = resolveBadgeProfile(snap);
  const isRu50 = file.name.toLowerCase().endsWith('.ru50');
  const isPicture = file.type.startsWith('image/') ||
    /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(file.name);

  try {
    if (isRu50 && !profile.bg02) {
      throw new Error('RU50 is only supported for BG02/LJ733 badges');
    }
    if (!isRu50 && !isPicture) {
      throw new Error('Choose a JPG, PNG, WebP or RU50 image');
    }
    let next;
    if (isRu50) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = inspectRu50(bytes);
      next = {
        blob:file, bytes, width:info.width, height:info.height,
        format:'ru50', source:'encoded',
      };
    } else if (profile.bg02) {
      const image = await loadImage(file);
      next = {
        bytes:null, width:240, height:240,
        format:profile.format, source:'crop', name:file.name,
        sourceWidth:image.naturalWidth || image.width,
        sourceHeight:image.naturalHeight || image.height,
      };
      // Do not create a crop for an obsolete badge or image selection.
      if(token === previewGeneration &&
         snap.sessionId === client.getSnapshot().sessionId) {
        cropper.setImage(image);
        showCropper();
      }
    } else {
      next = await prepareFileForBadge(file, {
        width:Number($('#dialW').value)||profile.width,
        height:Number($('#dialH').value)||profile.height,
        quality:0.5,
        round:$('#roundMask').checked,
        format:profile.format,
      });
    }

    const now = client.getSnapshot();
    if(token !== previewGeneration || snap.sessionId !== now.sessionId ||
       resolveBadgeProfile(now).format !== next.format) return;

    prepared = next;
    updatePictureCodecControls(now);
    renderPictureSize(now);
    setUploadStatus(profile.bg02 && next.source === 'crop'
      ? 'Adjust framing, then Optimize picture or Convert & compare before uploading.'
      : profile.bg02
        ? 'Encoded RU50 selected. You can upload the existing file.'
        : 'Picture ready. Select Upload to badge.', 'ok');
    if (isRu50) {
      $('#dialPreview').hidden = true;
      $('#dialPlaceholder').hidden = false;
      $('#dialPlaceholder').textContent = 'Encoded RU50 image ready';
      $('#imageMeta').textContent =
        `${file.name} → 240×240 RU50/ETC2 · ${formatBytes(next.bytes.length)}`;
    } else if (profile.bg02) {
      $('#imageMeta').textContent =
        `${file.name} → round 240×240 crop · compare ETC2 and JPEG before upload`;
    } else {
      $('#dialPreview').src = next.previewUrl;
      $('#dialPreview').hidden = false;
      $('#dialPlaceholder').hidden = true;
      $('#dial').classList.toggle('round',$('#roundMask').checked);
      const fmtLabel = next.format === 'jpeg444' ? 'JPEG 4:4:4' : 'RGB565';
      $('#imageMeta').textContent =
        `${file.name} → ${next.width}×${next.height} ${fmtLabel} · ${formatBytes(next.bytes.length)}`;
    }
  } catch(e) {
    if(token !== previewGeneration)return;
    cropper.clear();
    hideCropper();
    prepared=null;
    $('#imageMeta').textContent = `Unable to prepare picture: ${e.message}`;
    setUploadStatus(`Picture could not be prepared: ${e.message}`, 'err');
    toast(e.message,'err');
    log({msg:e.message,level:'err'});
  } finally {
    renderPictureSize();
    updatePushChecklist();
  }
}

async function pushImage() {
  if (!client.connected) {
    toast('Connect a badge first', 'err');
    setUploadStatus('Connect a badge first.', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    setUploadStatus('Choose a picture first.', 'err');
    return;
  }
  const activeSnapshot = client.getSnapshot();
  const activeProfile = resolveBadgeProfile(activeSnapshot);
  if (activeProfile.bg02 && prepared.source === 'crop') {
    setUploadStatus('Convert & compare the crop before uploading.', 'err');
    return;
  }
  if (activeProfile.bg02 && prepared.source === 'comparison' &&
      (!pictureComparison || !pictureComparison[pictureCodec() === 'jpeg444' ? 'jpeg' : 'ru50'] ||
       prepared.format !== pictureCodec())) {
    setUploadStatus('Comparison no longer matches the selected format. Convert again.', 'err');
    return;
  }
  if (prepared.format === 'ru50') {
    if (activeSnapshot.protocolMode !== 'fitpro' || !looksLikeBg02(activeSnapshot)) {
      toast('RU50 requires a confirmed BG02/LJ733 FitPro badge', 'err');
      setUploadStatus('This picture format does not match the connected badge.', 'err');
      return;
    }
    log({ msg: 'BG02 RU50/ETC2 image transfer', level: 'info' });
  }
  if (activeProfile.bg02 && prepared.format === 'jpeg444') {
    if (!activeProfile.jpegExperimentSupported) {
      setUploadStatus('JPEG upload requires BG02 V1.5 with algorithm 4 reported.', 'err');
      return;
    }
    if (!window.confirm(
      'Upload the prepared JPEG to the BG02 and change its displayed picture? ' +
      'Your existing badge photo may be replaced. Continue?'
    )) return;
  }
  if (!imageMatchesBadge(prepared, activeProfile, activeSnapshot)) {
    toast('Image format does not match this badge. Select a compatible image.', 'err');
    setUploadStatus('This picture belongs to a different badge. Choose it again.', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  wrap.setAttribute('aria-valuenow', '0');
  setUploadStatus('Preparing your picture for transfer…', 'busy');
  transferring = true;
  updatePushChecklist();
  let beforePictureBytes = Number.isSafeInteger(activeSnapshot.freeStorage)
    ? activeSnapshot.freeStorage : null;
  try {
    let uploadBytes = prepared.bytes;
    if (activeProfile.bg02 && prepared.format === 'jpeg444') {
      const storage = await client.refreshFitProStorage({ timeoutMs: 5000 });
      beforePictureBytes = storage.reportedBytes;
      const after = client.getSnapshot();
      if (after.sessionId !== activeSnapshot.sessionId ||
          !resolveBadgeProfile(after).jpegExperimentSupported) {
        throw new Error('Badge identity or JPEG capability changed during preflight');
      }
      const estimate = estimatePictureStorage({
        bg02: true, format: 'jpeg444',
        encodedBytes: uploadBytes.length,
        availableBytes: storage.reportedBytes,
      });
      if (estimate?.fits === false) {
        throw new Error('JPEG needs ~' +
          formatBytes(estimate.allocationHint) +
          ' but only ~' + formatBytes(storage.reportedBytes) +
          ' is reported free. No bytes were uploaded.');
      }
    }
    if (prepared.source === 'crop') {
      log({ msg: 'Cropping and converting the picture for BG02…', level:'info' });
      setUploadStatus('Converting your picture for BG02…', 'busy');
      if (activeProfile.bg02) {
        throw new Error('BG02 source pictures must be compared before uploading');
      }
      uploadBytes = await encodeImageDataRu50(cropper.getImageData(240));
      const snapshot = client.getSnapshot();
      if (!client.connected || snapshot.sessionId !== activeSnapshot.sessionId ||
          !resolveBadgeProfile(snapshot).bg02) {
        throw new Error('Badge changed during image conversion; reconnect and try again');
      }
      inspectRu50(uploadBytes);
      log({ msg: `Image encoded: ${formatBytes(uploadBytes.length)} RU50/ETC2`, level:'ok' });
    }
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const onProgress = (pct) => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      bar.style.width = `${percent}%`;
      wrap.setAttribute('aria-valuenow', String(percent));
      setUploadStatus(`Sending picture… ${percent}%`, 'busy');
    };
    // Dedicated JPEG method validates the exact identity, algorithm=4 and
    // 240x240 baseline 4:4:4 before any Bluetooth write.
    const result = activeProfile.bg02 && prepared.format === 'jpeg444'
      ? await client.transferBg02Jpeg(uploadBytes, { onProgress })
      : await client.transferFile(uploadBytes, {
          fileType: FileType.IMAGE,
          functionType,
          allocateId: $('#allocMedia').checked,
          onProgress,
        });
    const via = result.path === 'fitpro-dial31' ? 'dial31' : 'baji';
    setUploadStatus(activeProfile.bg02 && prepared.format === 'jpeg444'
      ? 'JPEG transfer acknowledged. Confirm that the badge displays and retains it correctly.'
      : result.verified === false
        ? 'Transfer finished, but verification is unclear. Check the badge screen.'
        : 'Transfer acknowledged. Check the picture on the badge screen.', 'ok');
    toast(
      result.verified === false
        ? 'Uploaded (verify unclear)'
        : resolveBadgeProfile(activeSnapshot).bg02
          ? 'Transfer complete — check the BG02 display'
          : `Pushed to ${client.name || 'badge'} (${via})`,
      'ok',
    );
    log({
      msg: `Push complete → ${client.name || result.sessionId} via=${via} id=${result.mediaId} sum=0x${Number(result.checksum).toString(16)}`,
      level: 'ok',
    });
    if (activeProfile.bg02 && beforePictureBytes != null) {
      try {
        const newStorage = await client.refreshFitProStorage({ timeoutMs: 5000 });
        if (client.getSnapshot().sessionId === activeSnapshot.sessionId &&
            Number.isSafeInteger(newStorage.reportedBytes)) {
          const delta = beforePictureBytes - newStorage.reportedBytes;
          const estimate = estimatePictureStorage({
            bg02: true, format: prepared.format, encodedBytes: uploadBytes.length,
          });
          $('#pictureStorageDelta').textContent =
            'Observed storage: before ' + formatBytes(beforePictureBytes) +
            ' · after ' + formatBytes(newStorage.reportedBytes) +
            ' · change ' + (delta >= 0 ? '-' : '+') +
            formatBytes(Math.abs(delta)) +
            ' (estimated allocation ' + formatBytes(estimate.allocationHint) +
            '). A replacement may reclaim older blocks.';
        }
      } catch (e) {
        $('#pictureStorageDelta').textContent =
          'Upload acknowledged; post-upload storage reading unavailable.';
        log({ msg:'Post-upload storage read: ' + e.message, level:'warn' });
      }
    }
    if (via === 'baji') {
      $('#mediaIdPill').textContent = `Media ID ${result.mediaId}`;
      client.requestMediaList().catch(() => {});
    } else {
      $('#mediaIdPill').textContent = 'FitPro dial31';
    }
  } catch (e) {
    setUploadStatus(`Upload failed: ${e.message}. You can try again.`, 'err');
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

async function pushAll() {
  if (client.sessionCount < 2) {
    toast('Connect at least two badges', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  if (prepared.format === 'ru50' || 
      (prepared.format === 'jpeg444' && resolveBadgeProfile(client.getSnapshot()).bg02)) {
    toast('Experimental BG02 image formats are limited to one verified badge at a time', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  transferring = true;
  updatePushChecklist();
  log({
    msg: `Simultaneous push to ${client.sessionCount} badges…`,
    level: 'info',
  });
  try {
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const results = await client.transferFileToAll(prepared.bytes, {
      fileType: FileType.IMAGE,
      functionType,
      allocateId: $('#allocMedia').checked,
      onProgress: (pct, detail) => {
        bar.style.width = `${pct}%`;
        if (detail?.perBadge?.length) {
          const bits = detail.perBadge
            .map((b) => `${b.name || b.sessionId} ${b.percent}%`)
            .join(' · ');
          bar.title = bits;
        }
      },
    });
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    toast(
      fail
        ? `Simultaneous push: ${ok}/${results.length} ok`
        : `Pushed to all ${ok} badges (simultaneous)`,
      fail ? 'err' : 'ok',
    );
    for (const r of results) {
      log({
        msg: r.ok
          ? `Push OK → ${r.name || r.sessionId} mediaId=${r.mediaId}`
          : `Push fail → ${r.name || r.sessionId}: ${r.error}`,
        level: r.ok ? 'ok' : 'err',
      });
    }
    renderSnapshot();
    client.requestMediaList().catch(() => {});
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

function clearActiveUi() {
  renderSnapshot({
    name: null,
    model: null,
    firmware: null,
    hardware: null,
    software: null,
    manufacturer: null,
    battery: null,
    protocol: null,
    freeStorage: null,
    storageCapacity: null,
    mediaId: null,
  });
  $('#mediaList').innerHTML = '<div class="empty">Connect and refresh to load media.</div>';
  $('#mediaIdPill').textContent = 'Media ID —';
}

function bind() {
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnConnectAny').addEventListener('click', () => connect(true));
  $('#btnAddBadge').addEventListener('click', () => connect(false));
  $('#btnDisconnect').addEventListener('click', () =>
    client.disconnect().then(() => toast('Disconnected', 'ok')),
  );
  $('#btnDisconnectAll').addEventListener('click', () =>
    client.disconnectAll().then(() => toast('All badges disconnected', 'ok')),
  );
  $('#btnRefresh').addEventListener('click', () =>
    client
      .refreshIdentity()
      .then(() => {
        renderSnapshot();
        renderDeviceChips();
        toast('Device info refreshed', 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnRefreshStorage').addEventListener('click', async () => {
    try {
      if (!client.connected || client.anyTransferring) {
        throw new Error('Connect a badge and finish any upload first');
      }
      $('#btnRefreshStorage').disabled = true;
      const info = await client.refreshFitProStorage({ timeoutMs: 5000 });
      toast(`BG02 storage candidate: ~${formatBytes(info.reportedBytes)}`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
      log({ msg: `Storage refresh: ${e.message}`, level: 'warn' });
    } finally {
      renderSnapshot();
    }
  });
  $('#btnPair').addEventListener('click', () =>
    client.pair().catch((e) => toast(e.message, 'err')),
  );
  $('#pictureCodec').addEventListener('change', selectPictureCodec);
  $('#pictureJpegQuality').addEventListener('input', () => {
    $('#pictureJpegQualityLabel').textContent = $('#pictureJpegQuality').value;
    invalidatePictureComparison('JPEG quality changed. Reconvert to preview new bytes.');
  });
  $('#pictureCompareBuild').addEventListener('click', () => void comparePicture());
  $('#pictureQuickOptimize').addEventListener('click', () => void comparePicture(0));
  $('#pictureOptimizeCurrent').addEventListener('click', () => void comparePicture(0));
  $('#pictureOptimizeSmaller').addEventListener('click', () => void comparePicture(-1));
  $('#pictureOptimizeLarger').addEventListener('click', () => void comparePicture(1));
  $('#pictureSaveProject').addEventListener('click', () => {
    void savePictureProject().catch(e => toast(e.message, 'err'));
  });
  $('#pictureOpenProject').addEventListener('click', () => $('#pictureProjectFile').click());
  $('#pictureProjectFile').addEventListener('change', () => {
    const file = $('#pictureProjectFile').files?.[0];
    $('#pictureProjectFile').value = '';
    if (file) void openPictureProject(file).catch(e => toast(e.message, 'err'));
  });
  $('#pictureDownloadPrepared').addEventListener('click', () => {
    try { downloadPreparedPicture(); } catch (e) { toast(e.message, 'err'); }
  });
  $('#btnPickImage').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', () => rebuildPreview());
  $('#dialW').addEventListener('change', () => rebuildPreview());
  $('#dialH').addEventListener('change', () => rebuildPreview());
  $('#roundMask').addEventListener('change', () => rebuildPreview());
  $('#btnPush').addEventListener('click', () => pushImage());
  $('#btnPushAll').addEventListener('click', () => pushAll());
  $('#btnMediaList').addEventListener('click', () =>
    client.requestMediaList().catch((e) => {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }),
  );
  $('#btnAllocId').addEventListener('click', () =>
    client
      .allocateMediaId()
      .then((id) => {
        $('#mediaIdPill').textContent = `Media ID ${id}`;
        toast(`Allocated ${id}`, 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnClearLog').addEventListener('click', () => {
    $('#activityLog').innerHTML = '';
  });

  client.addEventListener('log', (e) => log(e.detail));
  client.addEventListener('sessions', () => {
    syncConnectionChrome();
    renderDeviceChips();
    videoController?.update();
  });
  client.addEventListener('connection', (e) => {
    syncConnectionChrome();
    renderDeviceChips();
    if (!e.detail.connected && client.sessionCount === 0) {
      clearActiveUi();
    } else {
      renderSnapshot();
    }
  });
  client.addEventListener('snapshot', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderSnapshot(e.detail.snapshot);
    }
    renderDeviceChips();
  });
  client.addEventListener('deviceinfo', () => renderSnapshot());
  client.addEventListener('disinfo', () => renderSnapshot());
  client.addEventListener('battery', () => {
    renderSnapshot();
    renderDeviceChips();
  });
  client.addEventListener('mediaid', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      $('#mediaIdPill').textContent = `Media ID ${e.detail.mediaId}`;
    }
  });
  client.addEventListener('medialist', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderMediaList(e.detail.items);
    }
  });
}

function initSupport() {
  const secure = window.isSecureContext;
  if (!secure) {
    setPill($('#blePill'), 'Needs HTTPS (or localhost)', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
    log({
      msg: 'Insecure context — Web Bluetooth is blocked. Use GitHub Pages HTTPS or localhost.',
      level: 'err',
    });
    return;
  }
  if (SuperBandClient.supported()) {
    setPill($('#blePill'), 'Web Bluetooth ready', 'ok');
  } else {
    setPill($('#blePill'), 'Web Bluetooth unavailable', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
  }
}

const FALLBACK_VERSION = '2026.08.11.1';

function applyVersionLabel(version, builtAt = null) {
  const hero = $('#appVersion');
  if (hero) hero.textContent = version;

  const el = $('#buildMeta');
  if (!el) return;
  el.innerHTML = '';
  const a = document.createElement('a');
  a.href = REPO_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `Badge Manager v${version}`;
  el.appendChild(a);
  if (builtAt) {
    el.appendChild(document.createTextNode(` · ${builtAt}`));
  }
}

async function initBuildMeta() {
  applyVersionLabel(FALLBACK_VERSION);
  try {
    // Site-root version.json (written by Pages / local build), not next to the JS chunk.
    const res = await fetch(new URL('version.json', document.baseURI));
    if (!res.ok) throw new Error('no version');
    const data = await res.json();
    if (data?.version) {
      applyVersionLabel(String(data.version), data.built_at || null);
    }
  } catch {
    // Keep FALLBACK_VERSION from HTML / package.json.
  }
}

bind();
videoController = bindVideo({ client, log, toast, $ });
libraryController = bindBg02Library({ client, log, $ });
bindAdvanced({ client, log, toast, $ });
initSupport();
initBuildMeta();
syncConnectionChrome();
updatePushChecklist();
log({
  msg: 'Badge Manager ready. Connect a badge to select its display dimensions and image format.',
  level: 'info',
});
