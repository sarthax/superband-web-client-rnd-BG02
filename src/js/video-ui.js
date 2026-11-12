/** BG02 video UI; separate from all picture-selection/crop/upload state. */
import { openVideoSource, convertVideoToBg02Avi, gifFrameThumbnail } from './video-convert.js';
import { planTrimmedVideo, planGifStoryboard } from './video-timeline.js';
import { formatBytes } from './image.js';
import { BG02_VIDEO } from './video-avi.js';
import { resolveBadgeProfile } from './device-profile.js';
import { AviComparisonPreview } from './video-preview.js';
import { VideoCropEditor } from './video-crop-ui.js';

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
    fps: $('#videoFps'),
    fpsInfo: $('#videoFpsInfo'),
    quality: $('#videoQuality'),
    fit: $('#videoFit'),
    loop: $('#videoLoop'),
    rangeInfo: $('#videoRangeInfo'),
    gifPicker: $('#gifFramePicker'),
    gifUseFrames: $('#gifUseFrames'),
    gifPrev: $('#gifPrev'),
    gifNext: $('#gifNext'),
    gifPage: $('#gifPage'),
    gifHold: $('#gifHold'),
    gifClear: $('#gifClear'),
    gifSelectedInfo: $('#gifSelectedInfo'),
    gifFrameGrid: $('#gifFrameGrid'),
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

  const comparison = new AviComparisonPreview({
    root: $('#videoCompare'),
    sourceCanvas: $('#videoCompareSource'),
    encodedCanvas: $('#videoCompareEncoded'),
    sourceCaption: $('#videoCompareSourceCaption'),
    play: $('#videoComparePlay'),
    previous: $('#videoComparePrevious'),
    next: $('#videoCompareNext'),
    seek: $('#videoCompareSeek'),
    position: $('#videoComparePosition'),
    description: $('#videoCompareDescription'),
  });

  let source = null;
  let converted = null;
  let pending = null;
  let working = false;
  let uploading = false;
  let generation = 0;
  let framePage = 0;
  let thumbnailEpoch = 0;
  const selectedGifFrames = new Set();
  const FRAMES_PER_PAGE = 24;
  const cropEditor = new VideoCropEditor({
    $,
    selectedFrames: selectedGifFrames,
    getFit: () => els.fit.value,
    previewVideo: els.player,
    canEdit: () => !working && !uploading && !client.anyTransferring,
    onChanged: () => {
      generation++;
      clearOutput();
      notify('Framing changed. Convert again to see the updated AVI.');
      refresh();
    },
    onThumbsDirty: () => {
      if (source?.kind === 'gif') void renderFramePage();
    },
  });

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
    comparison.reset();
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
      start, end, seconds, fps: Number(els.fps.value),
      quality: els.quality.value,
      fit: els.fit.value, loop: els.loop.checked,
      frameIndices: source.kind === 'gif' && els.gifUseFrames.checked ?
        [...selectedGifFrames] : null,
      // Frame holds are whole output frames; this is the exact duration
      // (one frame at 0.5fps lasts two seconds).
      holdSeconds: Number(els.gifHold.value) / Number(els.fps.value),
      ...cropEditor.snapshot(),
    };
  }

  function updateFrameRateLabels() {
    const fps = Number(els.fps.value);
    for (const option of els.gifHold.options) {
      const frames = Number(option.value);
      const duration = frames / fps;
      option.textContent = frames + (frames === 1 ? ' AVI frame' : ' AVI frames') +
        ' (' + duration.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' seconds)';
    }
    els.fpsInfo.textContent = fps === 3
      ? '3 fps matches the recovered SuperBand format. Frame duration: 0.33 seconds.'
      : fps + ' fps is experimental: each complete frame lasts ' +
        (1 / fps).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') +
        ' seconds. Playback speed and acceptance are not yet verified.';
  }

  function showRange() {
    updateFrameRateLabels();
    if (!source) return;
    const sel = selection();
    if (source.kind === 'avi') {
      els.startLabel.textContent = '0.0 s';
      els.endLabel.textContent = fmtTime(source.durationSeconds);
      els.rangeInfo.textContent = 'Compatible MJPEG AVI at ' +
        source.aviInfo.fps + ' fps: pass through unchanged (no trim or re-encoding).';
      return;
    }
    els.startLabel.textContent = fmtTime(sel.start);
    els.endLabel.textContent = fmtTime(sel.end);
    if (source.kind === 'gif') {
      const selected = selectedGifFrames.size;
      els.gifSelectedInfo.textContent = selected + ' of ' + source.ends.length +
        ' original GIF frames selected. ' +
        (els.gifUseFrames.checked ? 'Selection controls AVI output.' :
          'Enable “Encode only my selected GIF frames” to use them.');
    }
    try {
      const plan = sel.frameIndices !== null
        ? planGifStoryboard({
          frameIndices: sel.frameIndices,
          sourceFrameCount: source.ends.length,
          holdSeconds: sel.holdSeconds, maxSeconds: sel.seconds,
          loop: sel.loop, fps: sel.fps,
        })
        : planTrimmedVideo({
          start: sel.start, end: sel.end,
          maxSeconds: sel.seconds, loop: sel.loop, fps: sel.fps,
        });
      const baseline = sel.fps === 3 ? plan : (
        sel.frameIndices !== null
          ? planGifStoryboard({
            frameIndices: sel.frameIndices,
            sourceFrameCount: source.ends.length,
            holdSeconds: sel.holdSeconds,
            maxSeconds: sel.seconds, loop: sel.loop, fps: 3,
          })
          : planTrimmedVideo({
            start: sel.start, end: sel.end,
            maxSeconds: sel.seconds, loop: sel.loop, fps: 3,
          })
      );
      const fewerFrames = Math.max(0, Math.round(
        100 * (1 - plan.frameCount / baseline.frameCount)
      ));
      const label = sel.frameIndices !== null
        ? selectedGifFrames.size + ' chosen frames'
        : 'Source segment ' + fmtTime(sel.end - sel.start) +
          ' (' + fmtTime(sel.start) + '–' + fmtTime(sel.end) + ')';
      els.rangeInfo.textContent = label + ' → ' +
        plan.frameCount + ' AVI frames at ' + sel.fps + ' fps / ' +
        fmtTime(plan.seconds) + ' (maximum ' + fmtTime(sel.seconds) + ')' +
        (sel.fps !== 3 ? ' · ' + fewerFrames + '% fewer frames than 3 fps' : '') +
        (plan.clipped ? ' · selection capped' : '') +
        (plan.repeated ? ' · repeated by choice' : ' · no automatic repeat');
    } catch (e) {
      els.rangeInfo.textContent = e.message;
    }
    if (source.kind === 'video') {
      els.player.currentTime = Math.max(0, Math.min(
        source.durationSeconds - .04, sel.start,
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
    cropEditor.setDisabled(!idle);
    const aviOriginal = source?.kind === 'avi';
    const gif = source?.kind === 'gif';
    const useFrames = gif && els.gifUseFrames.checked;
    els.gifPicker.hidden = !gif;
    els.gifUseFrames.disabled = !gif || !idle;
    els.gifHold.disabled = !useFrames || !idle;
    els.gifPrev.disabled = !gif || !idle || framePage === 0;
    els.gifNext.disabled = !gif || !idle ||
      (framePage + 1) * FRAMES_PER_PAGE >= (source?.ends?.length || 0);
    els.gifClear.disabled = !gif || !idle || selectedGifFrames.size === 0;
    els.convert.textContent = aviOriginal ? 'Use AVI unchanged' : 'Convert & measure AVI';
    els.pick.disabled = !idle;
    els.input.disabled = !idle;
    els.start.disabled = !source || !idle || aviOriginal || useFrames;
    els.end.disabled = !source || !idle || aviOriginal || useFrames;
    els.seconds.disabled = !idle || aviOriginal;
    els.fps.disabled = !idle || aviOriginal;
    els.quality.disabled = !idle || aviOriginal;
    els.fit.disabled = !idle || aviOriginal;
    els.loop.disabled = !idle || aviOriginal;
    els.convert.disabled = !source || !idle || (useFrames && !selectedGifFrames.size);
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

  /** Show only 24 original GIF frames at a time; keep selection across pages. */
  async function renderFramePage() {
    const original = source;
    const token = ++thumbnailEpoch;
    if (original?.kind !== 'gif') return;
    const total = original.ends.length;
    const pages = Math.ceil(total / FRAMES_PER_PAGE);
    framePage = Math.max(0, Math.min(framePage, pages - 1));
    const from = framePage * FRAMES_PER_PAGE;
    const to = Math.min(total, from + FRAMES_PER_PAGE);
    els.gifPage.textContent = 'Frames ' + (from + 1) + '–' + to +
      ' of ' + total + ' (page ' + (framePage + 1) + '/' + pages + ')';
    els.gifFrameGrid.replaceChildren();
    refresh();
    for (let i = from; i < to; i++) {
      let poster;
      try {
        poster = await gifFrameThumbnail(original, i,
          cropEditor.cropForFrame(i), els.fit.value);
      } catch (e) {
        if (token === thumbnailEpoch) {
          log({ msg: 'GIF frame #' + (i + 1) + ': ' + e.message, level: 'warn' });
        }
        continue;
      }
      if (token !== thumbnailEpoch || source !== original) return;
      const tile = document.createElement('div');
      tile.className = 'gif-frame-tile';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gif-frame-card';
      button.dataset.frameIndex = String(i);
      button.setAttribute('aria-pressed', String(selectedGifFrames.has(i)));
      const startTime = i === 0 ? 0 : original.ends[i - 1] / 1000;
      button.title = 'GIF source frame ' + (i + 1) + ' at ' + fmtTime(startTime);
      const img = document.createElement('img');
      img.alt = '';
      img.src = poster;
      img.loading = 'lazy';
      const meta = document.createElement('span');
      meta.textContent = '#' + (i + 1) + ' · ' + fmtTime(startTime);
      button.append(img, meta);
      button.addEventListener('click', () => {
        if (source !== original || working || uploading || client.anyTransferring) return;
        if (selectedGifFrames.has(i)) {
          selectedGifFrames.delete(i);
        } else {
          selectedGifFrames.add(i);
          cropEditor.setActiveFrame(i, true);
        }
        cropEditor.onSelectionChanged();
        els.gifUseFrames.checked = selectedGifFrames.size > 0;
        button.setAttribute('aria-pressed', String(selectedGifFrames.has(i)));
        invalidated();
      });
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'gif-frame-edit';
      edit.textContent = 'Edit crop';
      edit.disabled = !selectedGifFrames.has(i);
      edit.addEventListener('click', () => {
        if (source !== original || working || uploading || client.anyTransferring ||
            !selectedGifFrames.has(i)) return;
        cropEditor.setActiveFrame(i, true);
        cropEditor.els.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      tile.append(button, edit);
      els.gifFrameGrid.appendChild(tile);
      cropEditor.syncFrameCards();
    }
  }

  function setPreset() {
    // Preset caps output duration: do not alter the selected source interval.
    if (source) invalidated();
  }

  async function chooseFile() {
    if (working || uploading) return;
    const file = els.input.files?.[0];
    if (!file) return;
    const request = ++generation;
    cropEditor.clear();
    source?.close();
    source = null;
    thumbnailEpoch++;
    framePage = 0;
    selectedGifFrames.clear();
    els.gifUseFrames.checked = false;
    els.gifFrameGrid.replaceChildren();
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
      if (request !== generation) { candidate.close(); return; }
      source = candidate;
      cropEditor.setSource(candidate);
      els.sourceDetails.textContent = candidate.name + ' · ' +
        candidate.width + '×' + candidate.height + ' · ' +
        fmtTime(candidate.durationSeconds) +
        (candidate.kind === 'gif' ? ' · animated GIF' :
          candidate.kind === 'avi' ? ' · compatible MJPEG AVI' : ' · browser video');
      els.placeholder.hidden = true;
      if (candidate.kind === 'gif' || candidate.kind === 'avi') {
        els.gif.src = candidate.previewUrl;
        els.gif.alt = candidate.kind === 'avi' ?
          'First frame of AVI' : 'Animated GIF source preview';
        els.gif.hidden = false;
      } else {
        els.player.src = candidate.previewUrl;
        els.player.hidden = false;
      }
      els.start.value = '0';
      els.end.value = String(candidate.durationSeconds);
      if (candidate.kind === 'avi') els.fps.value = String(candidate.aviInfo.fps);
      els.loop.checked = false; // Never repeat short GIFs implicitly.
      syncMarkerLimits();
      showRange();
      if (candidate.kind === 'gif') void renderFramePage();
      notify(candidate.kind === 'avi'
        ? 'Compatible AVI loaded. Use unchanged AVI to measure and upload.'
        : 'Adjust the selection, then convert and measure its actual AVI size.');
      refresh();
    } catch (e) {
      if (request !== generation) return;
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
      const result = source.kind === 'avi' ? {
        bytes: source.aviBytes,
        info: source.aviInfo,
        thumbnail: source.previewUrl,
        quality: 'original',
        sourceName: source.name,
      } : await convertVideoToBg02Avi(source, {
        ...selected,
        signal: controller.signal,
        onProgress: ({ percent, frame, total }) =>
          progress(percent, 'Encoding frame ' + frame + ' / ' + total),
      });
      if (current !== generation || controller.signal.aborted) {
        for (const frame of result.referenceFrames || []) frame.close();
        return;
      }
      converted = result;
      // Decode real JPEGs from the completed AVI (not the browser's native
      // AVI video decoder) and place them beside the exact sampled source.
      // Preview problems must not turn a correctly encoded file into a failure.
      try {
        comparison.setResult(result);
      } catch (e) {
        for (const frame of result.referenceFrames || []) frame.close();
        result.referenceFrames = null;
        log({ msg: 'AVI side-by-side preview unavailable: ' + e.message, level: 'warn' });
      }
      els.outputFrame.src = result.thumbnail;
      els.outputFrame.hidden = false;
      els.exactSize.textContent = 'AVI: ' + formatBytes(result.bytes.length) +
        ' (' + result.bytes.length.toLocaleString() + ' bytes)' +
        ' · ' + result.info.frames + ' frames at ' +
        result.info.fps + ' fps / ' + fmtTime(result.info.seconds);
      const durationWarning = result.info.seconds > BG02_VIDEO.VERIFIED_SECONDS;
      const experimentalFps = result.info.fps !== BG02_VIDEO.FPS;
      els.status.textContent = experimentalFps
        ? 'AVI converted. ' + result.info.fps +
          ' fps is experimental — badge playback may be sped up, truncated or rejected.'
        : source.kind === 'avi'
        ? 'Original 3 fps AVI kept unchanged. You can upload this exact file.'
        : durationWarning
        ? 'Converted. Longer-than-five-second playback is unverified; test on the badge.'
        : 'Converted at the recovered 3 fps reference; browser JPEG playback needs a badge check.';
      log({ msg: 'Video AVI ready ' + result.bytes.length + ' bytes · ' +
        result.info.frames + ' frames · quality=' + selected.quality +
        ' · ' + result.info.seconds + 's · ' + result.info.fps + 'fps', level: 'ok' });
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
    if (item.info.seconds > BG02_VIDEO.VERIFIED_SECONDS ||
        item.info.fps !== BG02_VIDEO.FPS) {
      const warning = item.info.fps !== BG02_VIDEO.FPS
        ? 'This ' + item.info.fps +
          ' fps AVI is experimental. The badge may reject it or play it at the wrong speed.'
        : 'The badge playback limit beyond 5 seconds is unverified.';
      if (!confirm(warning + ' This may consume badge storage. Upload anyway?')) return;
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
      if (client.getSnapshot().sessionId !== activeId) {
        throw new Error('Active badge changed during storage preflight');
      }
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
  for (const el of [els.quality, els.loop]) {
    el.addEventListener('change', invalidated);
  }
  els.fit.addEventListener('change', () => {
    invalidated();
    void cropEditor.render();
    cropEditor.scheduleThumbs();
  });
  for (const name of ['loadeddata', 'seeked', 'timeupdate']) {
    els.player.addEventListener(name, () => {
      if (source?.kind === 'video') void cropEditor.render();
    });
  }
  els.seconds.addEventListener('change', setPreset);
  els.fps.addEventListener('change', invalidated);
  els.gifUseFrames.addEventListener('change', invalidated);
  els.gifHold.addEventListener('change', invalidated);
  els.gifClear.addEventListener('click', () => {
    if (!source || source.kind !== 'gif' || working || uploading) return;
    selectedGifFrames.clear();
    cropEditor.onSelectionChanged();
    els.gifFrameGrid.querySelectorAll('.gif-frame-card').forEach(
      (button) => button.setAttribute('aria-pressed', 'false'),
    );
    invalidated();
  });
  els.gifPrev.addEventListener('click', () => {
    if (framePage > 0) { framePage--; void renderFramePage(); }
  });
  els.gifNext.addEventListener('click', () => {
    if (source?.kind === 'gif' &&
        (framePage + 1) * FRAMES_PER_PAGE < source.ends.length) {
      framePage++;
      void renderFramePage();
    }
  });

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
