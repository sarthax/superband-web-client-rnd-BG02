/** BG02 video UI; separate from all picture-selection/crop/upload state. */
import { openVideoSource, convertVideoToBg02Avi } from './video-convert.js';
import { formatBytes } from './image.js';
import { BG02_VIDEO } from './video-avi.js';
import { resolveBadgeProfile } from './device-profile.js';

export function bindVideo({ client, log, toast, $ }) {
  const els = {
    section: $('#videoSection'),
    input: $('#videoInput'),
    pick: $('#videoPick'),
    player: $('#videoSourcePlayer'),
    gif: $('#videoSourceGif'),
    sourceDetails: $('#videoSourceDetails'),
    placeholder: $('#videoPreviewPlaceholder'),
    start: $('#videoStart'),
    end: $('#videoEnd'),
    startLabel: $('#videoStartLabel'),
    endLabel: $('#videoEndLabel'),
    seconds: $('#videoSeconds'),
    quality: $('#videoQuality'),
    fit: $('#videoFit'),
    loop: $('#videoLoop'),
    rangeInfo: $('#videoRangeInfo'),
    convert: $('#videoConvert'),
    cancel: $('#videoCancel'),
    download: $('#videoDownload'),
    upload: $('#videoUpload'),
    outputFrame: $('#videoOutputFrame'),
    exactSize: $('#videoExactSize'),
    spaceInfo: $('#videoSpaceInfo'),
    status: $('#videoStatus'),
    progress: $('#videoProgress'),
    bar: $('#videoBar'),
  };

  let source = null;
  let converted = null;
  let pending = null;
  let working = false;
  let uploading = false;
  let generation = 0;

  const fmtTime = (seconds) => Number(seconds || 0).toFixed(1) + ' s';
  const notify = (message, level = 'info') => {
    els.status.textContent = message;
    if (level === 'err') log({ msg: 'Video: ' + message, level: 'warn' });
  };
  const progress = (percent, phase) => {
    els.progress.hidden = false;
    els.bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    els.progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    if (phase) els.status.textContent = phase;
  };

  function clearOutput() {
    converted = null;
    els.outputFrame.hidden = true;
    els.outputFrame.removeAttribute('src');
    els.exactSize.textContent = 'Not converted yet';
    els.spaceInfo.textContent =
      'Actual AVI size and estimated space usage appear after conversion.';
    els.download.disabled = true;
    els.upload.disabled = true;
  }

  function selection() {
    if (!source) return null;
    const start = Number(els.start.value);
    const end = Number(els.end.value);
    const seconds = Number(els.seconds.value);
    return {
      start, end, seconds, quality: els.quality.value,
      fit: els.fit.value, loop: els.loop.checked,
    };
  }

  function showRange() {
    if (!source) return;
    const s = selection();
    els.startLabel.textContent = fmtTime(s.start);
    els.endLabel.textContent = fmtTime(s.end);
    const duration = Math.max(0, s.end - s.start);
    els.rangeInfo.textContent = 'Source selection ' + fmtTime(duration) +
      ' (' + fmtTime(s.start) + '–' + fmtTime(s.end) + ') → AVI ' +
      fmtTime(s.seconds) + ' at 3 fps / ' +
      Math.round(s.seconds * BG02_VIDEO.FPS) + ' frames' +
      (s.loop ? ' · repeat selected segment' : ' · no repeat');
    if (source.kind === 'video') {
      els.player.currentTime = Math.max(0, Math.min(
        source.durationSeconds - .04, s.start,
      ));
    }
  }

  function invalidated() {
    generation++;
    clearOutput();
    showRange();
    notify('Options changed. Convert again to measure the exact AVI size.');
    refresh();
  }

  function refresh(snapshot = client.getSnapshot()) {
    // Conversion may be done offline; only actual send needs known BG02 V1.5.
    els.section.hidden = false;
    const profile = resolveBadgeProfile(snapshot);
    const supportedBadge = profile.bg02 && snapshot?.storageProbeSupported &&
      snapshot?.protocolMode === 'fitpro' && snapshot?.connected;
    const idle = !working && !uploading && !client.anyTransferring;
    els.pick.disabled = !idle;
    els.input.disabled = !idle;
    els.start.disabled = !source || !idle;
    els.end.disabled = !source || !idle;
    els.seconds.disabled = !idle;
    els.quality.disabled = !idle;
    els.fit.disabled = !idle;
    els.loop.disabled = !idle;
    els.convert.disabled = !source || !idle;
    els.download.disabled = !converted || !idle;
    const needed = converted?.info?.estimatedAllocationBytes;
    const free = snapshot?.freeStorage;
    const fits = !Number.isFinite(free) || needed <= free;
    els.upload.disabled = !converted || !idle || !supportedBadge || !fits;
    els.cancel.hidden = !working;
    if (converted && !uploading) {
      els.spaceInfo.classList.toggle('video-exceeds', !fits);
      els.spaceInfo.textContent = 'Estimated 8 KiB allocation: ' +
        formatBytes(needed) +
        ' · reported free: ' +
        (Number.isFinite(free) ? formatBytes(free) : 'unknown') +
        (!fits ? ' · TOO LARGE TO UPLOAD' : '');
    }
  }

  function syncMarkerLimits() {
    if (!source) return;
    const d = source.durationSeconds;
    const max = String(Math.max(.02, d));
    els.start.min = '0'; els.start.max = max;
    els.end.min = '0'; els.end.max = max;
    const a = Number(els.start.value);
    let b = Number(els.end.value);
    if (b <= a) {
      b = Math.min(d, a + Math.min(.1, d / 2));
      if (b <= a) els.start.value = Math.max(0, b - .02);
      els.end.value = String(b);
    }
  }

  function setPreset() {
    if (!source) return;
    const start = Number(els.start.value) || 0;
    els.end.value = String(Math.min(
      source.durationSeconds, start + Number(els.seconds.value),
    ));
    syncMarkerLimits();
    invalidated();
  }

  async function chooseFile() {
    if (working || uploading) return;
    const file = els.input.files?.[0];
    if (!file) return;
    generation++;
    source?.close();
    source = null;
    clearOutput();
    els.player.pause();
    els.player.hidden = true;
    els.player.removeAttribute('src');
    els.player.load();
    els.gif.hidden = true;
    els.gif.removeAttribute('src');
    els.placeholder.hidden = false;
    notify('Reading video metadata or GIF frames…');
    try {
      const candidate = await openVideoSource(file);
      source = candidate;
      els.sourceDetails.textContent = candidate.name + ' · ' +
        candidate.width + '×' + candidate.height + ' · ' +
        fmtTime(candidate.durationSeconds) +
        (candidate.kind === 'gif' ? ' · animated GIF' : ' · browser video');
      els.placeholder.hidden = true;
      if (candidate.kind === 'gif') {
        els.gif.src = candidate.previewUrl;
        els.gif.hidden = false;
      } else {
        els.player.src = candidate.previewUrl;
        els.player.hidden = false;
      }
      els.start.value = '0';
      els.end.value = String(Math.min(candidate.durationSeconds, 5));
      els.loop.checked = candidate.kind === 'gif' ||
        candidate.durationSeconds < Number(els.seconds.value);
      syncMarkerLimits();
      showRange();
      notify('Adjust the selection, then convert and measure its actual AVI size.');
      refresh();
    } catch (e) {
      els.sourceDetails.textContent = file.name + ' · cannot decode';
      notify(e.message, 'err');
      refresh();
    }
  }

  async function convert() {
    if (!source || working || uploading) return;
    const selected = selection();
    if (!selected) return;
    const current = ++generation;
    const controller = new AbortController();
    pending = controller;
    working = true;
    clearOutput();
    refresh();
    progress(0, 'Decoding and encoding 240×240 MJPEG frames…');
    try {
      const result = await convertVideoToBg02Avi(source, {
        ...selected,
        signal: controller.signal,
        onProgress: ({ percent, frame, total }) =>
          progress(percent, 'Encoding frame ' + frame + ' / ' + total),
      });
      if (current !== generation || controller.signal.aborted) return;
      converted = result;
      els.outputFrame.src = result.thumbnail;
      els.outputFrame.hidden = false;
      els.exactSize.textContent = 'AVI: ' + formatBytes(result.bytes.length) +
        ' (' + result.bytes.length.toLocaleString() + ' bytes)' +
        ' · ' + result.info.frames + ' frames / ' +
        fmtTime(result.info.seconds);
      const durationWarning = result.info.seconds > BG02_VIDEO.VERIFIED_SECONDS;
      els.status.textContent = durationWarning
        ? 'Converted. Longer-than-five-second playback is unverified; test on the badge.'
        : 'Converted. This AVI format matches the recovered 5-second file structure; playback must be checked.';
      log({ msg: 'Video AVI ready ' + result.bytes.length + ' bytes · ' +
        result.info.frames + ' frames · quality=' + selected.quality +
        ' · ' + result.info.seconds + 's', level: 'ok' });
    } catch (e) {
      if (e.name !== 'AbortError') notify('Conversion failed: ' + e.message, 'err');
      else notify('Conversion cancelled.');
    } finally {
      working = false;
      pending = null;
      els.progress.hidden = true;
      refresh();
    }
  }

  function download() {
    if (!converted) return;
    const blob = new Blob([converted.bytes], { type: 'video/x-msvideo' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (source?.name || 'badge-video').replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9_-]+/gi, '_');
    a.href = url;
    a.download = base + '-BG02-' + converted.info.seconds + 's.avi';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  async function upload() {
    if (!converted || working || uploading || client.anyTransferring) return;
    const snap = client.getSnapshot();
    if (!snap.connected || !snap.storageProbeSupported ||
        snap.protocolMode !== 'fitpro') {
      notify('Connect your verified BG02 V1.5 before uploading AVI.', 'err');
      return;
    }
    const item = converted;
    if (item.info.seconds > BG02_VIDEO.VERIFIED_SECONDS) {
      if (!confirm('Only 5-second AVI playback is verified. Longer videos may be rejected, truncated, or consume storage. Upload anyway?')) {
        return;
      }
    }
    uploading = true;
    refresh();
    try {
      progress(1, 'Checking available BG02 storage…');
      let free = snap.freeStorage;
      try {
        const latest = await client.refreshFitProStorage({ timeoutMs: 5000 });
        free = latest.reportedBytes;
      } catch (e) {
        log({ msg: 'Video storage preflight unavailable: ' + e.message, level: 'warn' });
        throw new Error('Cannot verify free storage before video transfer');
      }
      if (item.info.estimatedAllocationBytes > free) {
        throw new Error(
          'Video likely needs ' + formatBytes(item.info.estimatedAllocationBytes) +
          ' but only ' + formatBytes(free) + ' is available. Choose Low or a shorter clip.',
        );
      }
      const activeId = snap.sessionId;
      const result = await client.transferVideoAvi(item.bytes, {
        onProgress: (pct) => progress(
          Math.max(1, Math.min(100, Math.round(Number(pct) || 0))),
          'Uploading AVI to BG02… ' + Math.round(Number(pct) || 0) + '%',
        ),
      });
      if (client.getSnapshot().sessionId !== activeId) {
        throw new Error('Active badge changed during video upload');
      }
      notify('Video transfer acknowledged. Verify playback and loop duration on the badge.');
      toast('Video transfer acknowledged — check badge playback', 'ok');
      log({ msg: 'Video upload complete via FitPro dial type 1: ' +
        item.bytes.length + ' AVI bytes; playback still needs device check', level: 'ok' });
    } catch (e) {
      notify('Video upload failed: ' + e.message, 'err');
      toast('Video upload failed', 'err');
    } finally {
      uploading = false;
      els.progress.hidden = true;
      refresh();
    }
  }

  els.pick.addEventListener('click', () => els.input.click());
  els.input.addEventListener('change', chooseFile);
  els.convert.addEventListener('click', convert);
  els.cancel.addEventListener('click', () => pending?.abort());
  els.download.addEventListener('click', download);
  els.upload.addEventListener('click', upload);
  for (const el of [els.quality, els.fit, els.loop]) {
    el.addEventListener('change', invalidated);
  }
  els.seconds.addEventListener('change', setPreset);
  els.start.addEventListener('input', () => {
    if (!source) return;
    const a = Number(els.start.value), b = Number(els.end.value);
    if (a >= b) els.end.value = String(Math.min(source.durationSeconds, a + .1));
    syncMarkerLimits(); invalidated();
  });
  els.end.addEventListener('input', () => {
    if (!source) return;
    const a = Number(els.start.value), b = Number(els.end.value);
    if (b <= a) els.start.value = String(Math.max(0, b - .1));
    syncMarkerLimits(); invalidated();
  });

  const controller = { update: refresh };
  refresh();
  return controller;
}
