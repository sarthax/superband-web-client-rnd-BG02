/**
 * BG02 AVI output timeline (including experimental lower frame rates).
 * Duration selection is a maximum; never pad a shorter source without Repeat.
 */
import { BG02_VIDEO, bg02AviTimebase } from './video-avi.js';

function capFrames(seconds, fps) {
  bg02AviTimebase(fps); // validated rational AVI timebase
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 1 ||
      value > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS) {
    throw new Error('Maximum video duration must be 1–30 seconds');
  }
  const frames = Math.floor(value * fps + 1e-8);
  if (!frames) {
    throw new Error('Maximum duration is shorter than one frame at ' + fps + ' fps');
  }
  return frames;
}

/**
 * Sample [start,end) once, unless Repeat was chosen.
 * At 0.5 fps each complete MJPEG frame is 2 seconds long. A 5s
 * cap can hold 2 frames = 4s, never 3 frames = 6s.
 */
export function planTrimmedVideo({
  start, end, maxSeconds = 5, loop = false, fps = BG02_VIDEO.FPS,
}) {
  const from = Number(start), to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) ||
      from < 0 || to <= from) {
    throw new Error('Choose a nonempty start/stop segment');
  }
  const maxFrames = capFrames(maxSeconds, fps);
  const span = to - from;
  const frameCount = loop
    ? maxFrames
    : Math.max(1, Math.min(maxFrames, Math.floor(span * fps + 1e-8)));
  const sourceTimes = Array.from({ length: frameCount }, (_, i) =>
    from + (loop ? (i / fps) % span : Math.min(i / fps, Math.max(0, span - 1e-5)))
  );
  return {
    mode: 'trim', fps, frameCount,
    seconds: frameCount / fps,
    repeated: loop && frameCount / fps > span,
    sourceTimes,
  };
}

/**
 * Manual GIF storyboard in chronological order.
 * Prefer holdSeconds in UI. Legacy holdFrames (1/2/3/6 at 3fps) is
 * accepted so old callers and tests retain their original behavior.
 * Each selected still requires at least one AVI frame (duration 1/fps).
 */
export function planGifStoryboard({
  frameIndices, sourceFrameCount,
  holdFrames = 1, holdSeconds = null,
  maxSeconds = 5, loop = false, fps = BG02_VIDEO.FPS,
}) {
  const maxFrames = capFrames(maxSeconds, fps);
  let holdDuration;
  if (holdSeconds != null) {
    holdDuration = Number(holdSeconds);
    if (![1/3, 2/3, 1, 2].some(n => Math.abs(n - holdDuration) < 1e-6)) {
      throw new Error('Frame hold must be 1/3, 2/3, 1 or 2 seconds');
    }
  } else {
    if (!Number.isInteger(holdFrames) || ![1, 2, 3, 6].includes(holdFrames)) {
      throw new Error('Frame hold must be 1, 2, 3 or 6 original 3fps ticks');
    }
    holdDuration = holdFrames / BG02_VIDEO.FPS;
  }
  const holdOutputFrames = Math.max(1, Math.round(holdDuration * fps));
  const actualHoldSeconds = holdOutputFrames / fps;
  if (!Number.isInteger(sourceFrameCount) || sourceFrameCount < 1 ||
      !Array.isArray(frameIndices) || !frameIndices.length) {
    throw new Error('Select at least one GIF frame');
  }
  const selected = [...new Set(frameIndices)];
  if (selected.some(i => !Number.isInteger(i) || i < 0 || i >= sourceFrameCount)) {
    throw new Error('Selected GIF frame index is invalid');
  }
  selected.sort((a,b) => a-b);
  const frameIndexes = [];
  if (loop) {
    let i = 0;
    while (frameIndexes.length < maxFrames) {
      const current = selected[i % selected.length];
      for (let n = 0; n < holdOutputFrames && frameIndexes.length < maxFrames; n++)
        frameIndexes.push(current);
      i++;
    }
  } else {
    for (const current of selected) {
      for (let n = 0; n < holdOutputFrames && frameIndexes.length < maxFrames; n++)
        frameIndexes.push(current);
      if (frameIndexes.length === maxFrames) break;
    }
  }
  return {
    mode: 'frames', fps, selectedFrames: selected.length,
    holdOutputFrames, actualHoldSeconds,
    frameCount: frameIndexes.length,
    seconds: frameIndexes.length / fps,
    repeated: loop && frameIndexes.length > selected.length * holdOutputFrames,
    clipped: !loop && selected.length * holdOutputFrames > maxFrames,
    frameIndexes,
  };
}
