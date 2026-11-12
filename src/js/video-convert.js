/**
 * Browser-side BG02 MJPEG AVI encoder.
 * Video and animated GIF use Chrome/Edge's built-in media decoders.
 * ImageDecoder returns composited GIF frames and their playback durations.
 *
 * No MP4/WebM decoder is bundled. Unsupported formats fail with a clear error.
 */
import { BG02_VIDEO, muxBg02MjpegAvi, inspectBg02MjpegAvi, extractBg02AviFrame } from './video-avi.js';

export const VIDEO_QUALITIES = Object.freeze({
  low: { label: 'Low', jpegQuality: 0.30 },
  medium: { label: 'Medium', jpegQuality: 0.58 },
  high: { label: 'High', jpegQuality: 0.84 },
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const abortIf = (signal) => {
  if (signal?.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
};

function waitForMedia(el, okEvent, failEvent = 'error', timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(okEvent, done);
      el.removeEventListener(failEvent, fail);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => {
      cleanup();
      reject(new Error('This video cannot be decoded by the browser'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out opening or seeking video'));
    }, timeoutMs);
    el.addEventListener(okEvent, done, { once: true });
    el.addEventListener(failEvent, fail, { once: true });
  });
}

export async function openVideoSource(file) {
  if (!(file instanceof File)) throw new Error('Choose a local video or animated GIF');
  if (file.size > 150 * 1024 * 1024) {
    throw new Error('Files larger than 150 MB are not supported by the browser converter');
  }
  // Native playback of AVI is inconsistent across browsers. A known-good
  // SuperBand MJPEG AVI can instead be uploaded byte-for-byte as a control.
  if (/\.avi$/i.test(file.name) || /(?:x-msvideo|avi)/i.test(file.type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let info;
    try {
      info = inspectBg02MjpegAvi(bytes);
      if (info.seconds > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS) {
        throw new Error('Only AVI clips up to 30s are accepted by this workbench');
      }
    } catch (e) {
      throw new Error('AVI input must already be 240x240 MJPEG at 3 fps: ' + e.message);
    }
    const posterUrl = URL.createObjectURL(
      new Blob([extractBg02AviFrame(bytes, 0)], { type: 'image/jpeg' }),
    );
    return {
      kind: 'avi', name: file.name, width: info.width, height: info.height,
      durationSeconds: info.seconds, aviBytes: bytes, aviInfo: info,
      previewUrl: posterUrl,
      close() { URL.revokeObjectURL(posterUrl); },
    };
  }
  const gif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
  if (gif) {
    if (file.size > 25 * 1024 * 1024) {
      throw new Error('GIF input must be 25 MB or smaller');
    }
    if (typeof ImageDecoder === 'undefined' ||
        !(await ImageDecoder.isTypeSupported('image/gif'))) {
      throw new Error('Animated GIF conversion needs Chrome/Edge ImageDecoder support. Convert GIF to MP4 if unavailable.');
    }
    const decoder = new ImageDecoder({
      data: new Uint8Array(await file.arrayBuffer()),
      type: 'image/gif',
      preferAnimation: true,
    });
    try {
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount || 0;
      if (!count || count > 1500) throw new Error('GIF must have 1–1,500 frames');
      let durationMs = 0;
      let width = 0, height = 0;
      const ends = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        if (!width) {
          width = image.displayWidth;
          height = image.displayHeight;
          if (!width || !height || width * height > 2_000_000) {
            image.close();
            throw new Error('GIF source dimensions too large');
          }
        }
        const frameMs = Number(image.duration) / 1000;
        durationMs += Math.max(20, Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 100);
        ends.push(durationMs);
        image.close();
      }
      const previewUrl = URL.createObjectURL(file);
      return {
        kind: 'gif', name: file.name, width, height,
        durationSeconds: durationMs / 1000,
        decoder, ends, previewUrl,
        close() { decoder.close(); URL.revokeObjectURL(previewUrl); },
      };
    } catch (e) {
      decoder.close();
      throw e;
    }
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      const ready = waitForMedia(video, 'loadedmetadata');
      video.load();
      await ready;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0 ||
        !video.videoWidth || !video.videoHeight) {
      throw new Error('Video has no usable duration or dimensions');
    }
    video.pause();
    return {
      kind: 'video', name: file.name, width: video.videoWidth,
      height: video.videoHeight, durationSeconds: video.duration,
      video, previewUrl: url,
      close() { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(e.message + '. Try MP4 (H.264) or WebM, or convert AVI first.');
  }
}

function gifSampler(source) {
  return async (seconds) => {
    const ms = Math.max(0, Math.min(
      source.durationSeconds * 1000 - 0.001, seconds * 1000,
    ));
    let l = 0, r = source.ends.length - 1;
    while (l < r) {
      const m = (l + r) >> 1;
      if (ms < source.ends[m]) r = m;
      else l = m + 1;
    }
    // Chrome's ImageDecoder composites GIF disposal/transparency per frame.
    // It returns a VideoFrame: close it as soon as the canvas has sampled it.
    const { image } = await source.decoder.decode({ frameIndex: l });
    return image;
  };
}

async function seekVideo(source, seconds, signal) {
  abortIf(signal);
  const video = source.video;
  const target = Math.max(0, Math.min(source.durationSeconds - 0.04, seconds));
  if (Math.abs(video.currentTime - target) < 0.01 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const pending = waitForMedia(video, 'seeked', 'error', 12000);
  video.currentTime = target;
  await pending;
  abortIf(signal);
  // Permit the newly decoded video frame to advance into the rendering surface.
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function coverOrContain(ctx, picture, sourceWidth, sourceHeight, fit) {
  const w = BG02_VIDEO.WIDTH, h = BG02_VIDEO.HEIGHT;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const scale = fit === 'contain' ?
    Math.min(w / sourceWidth, h / sourceHeight) :
    Math.max(w / sourceWidth, h / sourceHeight);
  const dw = sourceWidth * scale, dh = sourceHeight * scale;
  ctx.drawImage(picture, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

async function jpegFromCanvas(canvas, quality) {
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
  if (!blob || blob.type !== 'image/jpeg') {
    throw new Error('Browser does not support JPEG canvas encoding');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('Browser produced an incomplete JPEG frame');
  }
  return bytes;
}

/**
 * Encode source into an exact-size BG02 AVI.
 * start/end are trim markers in the source timeline. When loop=true, the
 * selected region repeats until seconds have been emitted.
 */
export async function convertVideoToBg02Avi(source, {
  start = 0,
  end = source.durationSeconds,
  seconds = 5,
  loop = source.kind === 'gif',
  fit = 'cover',
  quality = 'medium',
  onProgress = () => {},
  signal = null,
} = {}) {
  if (!source || !['video', 'gif'].includes(source.kind)) {
    throw new Error('Choose a source video or GIF first');
  }
  const begin = Number(start), stop = Number(end);
  const duration = Number(seconds);
  if (!Number.isFinite(begin) || !Number.isFinite(stop) ||
      begin < 0 || stop <= begin || stop > source.durationSeconds + 0.01) {
    throw new Error('The start/stop trim markers must select part of the source');
  }
  if (!Number.isFinite(duration) || duration < 1 ||
      duration > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS) {
    throw new Error('Choose a clip between 1 and 30 seconds');
  }
  if (!loop && duration > stop - begin + 0.02) {
    throw new Error('Selected range is too short. Enable Loop selection or shorten output');
  }
  const opts = VIDEO_QUALITIES[quality];
  if (!opts) throw new Error('Unknown video quality preset');
  if (fit !== 'cover' && fit !== 'contain') throw new Error('Unknown picture fit');
  const total = Math.max(1, Math.round(duration * BG02_VIDEO.FPS));
  const canvas = document.createElement('canvas');
  canvas.width = BG02_VIDEO.WIDTH; canvas.height = BG02_VIDEO.HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const renderGif = source.kind === 'gif' ? gifSampler(source) : null;
  const frameBytes = [];
  let thumbnail = null;
  for (let i = 0; i < total; i++) {
    abortIf(signal);
    const t = i / BG02_VIDEO.FPS;
    const span = stop - begin;
    const at = begin + (loop ? t % span : Math.min(t, span - 0.001));
    let picture;
    if (source.kind === 'gif') picture = await renderGif(at);
    else {
      await seekVideo(source, at, signal);
      picture = source.video;
    }
    try {
      coverOrContain(ctx, picture, source.width, source.height, fit);
    } finally {
      if (source.kind === 'gif') picture.close();
    }
    if (i === 0) thumbnail = canvas.toDataURL('image/jpeg', opts.jpegQuality);
    frameBytes.push(await jpegFromCanvas(canvas, opts.jpegQuality));
    onProgress({ frame: i + 1, total, percent: Math.round((i + 1) * 100 / total) });
    // Avoid holding the UI thread for extended GIF/experimental conversions.
    if (i % 5 === 4) await wait(0);
  }
  abortIf(signal);
  const bytes = muxBg02MjpegAvi(frameBytes);
  const info = inspectBg02MjpegAvi(bytes);
  return { bytes, info, thumbnail, quality, loop, sourceName: source.name };
}
