/**
 * BG02 3fps output planning. A duration choice is a CAP, not a demand to pad.
 * Separate from browser decode so GIF-selection rules can be unit tested.
 */
import { BG02_VIDEO } from './video-avi.js';
const fps = BG02_VIDEO.FPS;

function capFrames(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 1 ||
      value > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS) {
    throw new Error('Maximum video duration must be 1–30 seconds');
  }
  return Math.max(1, Math.floor(value * fps + 1e-7));
}

/**
 * Source is read once from [start,end), unless loop is explicitly enabled.
 * AVI durations are whole frames at 3fps (floor for non-repeating clips).
 */
export function planTrimmedVideo({ start, end, maxSeconds = 5, loop = false }) {
  const from = Number(start), to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) ||
      from < 0 || to <= from) {
    throw new Error('Choose a nonempty start/stop segment');
  }
  const maxFrames = capFrames(maxSeconds);
  const span = to - from;
  const frameCount = loop
    ? maxFrames
    : Math.max(1, Math.min(maxFrames, Math.floor(span * fps + 1e-7)));
  const sourceTimes = Array.from({ length: frameCount }, (_, i) =>
    from + (loop ? (i / fps) % span : Math.min(i / fps, Math.max(0, span - 1e-5)))
  );
  return {
    mode: 'trim',
    frameCount, seconds: frameCount / fps,
    repeated: loop && frameCount / fps > span,
    sourceTimes,
  };
}

/**
 * Manual GIF storyboard, chronological order. Frame hold is 1,2,3 or 6
 * BG02 output frames per chosen GIF frame = 1/3, 2/3, 1 or 2 seconds each.
 * Selection never fills the cap by itself. Loop must be explicitly selected.
 */
export function planGifStoryboard({ frameIndices, sourceFrameCount,
  holdFrames = 1, maxSeconds = 5, loop = false }) {
  const maxFrames = capFrames(maxSeconds);
  if (!Number.isInteger(holdFrames) || ![1,2,3,6].includes(holdFrames)) {
    throw new Error('Frame hold must be 1, 2, 3 or 6 output frames');
  }
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
      for (let n = 0; n < holdFrames && frameIndexes.length < maxFrames; n++)
        frameIndexes.push(current);
      i++;
    }
  } else {
    for (const current of selected) {
      for (let n = 0; n < holdFrames && frameIndexes.length < maxFrames; n++)
        frameIndexes.push(current);
      if (frameIndexes.length === maxFrames) break;
    }
  }
  return {
    mode: 'frames',
    selectedFrames: selected.length,
    frameCount: frameIndexes.length,
    seconds: frameIndexes.length / fps,
    repeated: loop && frameIndexes.length > selected.length * holdFrames,
    clipped: !loop && selected.length * holdFrames > maxFrames,
    frameIndexes,
  };
}
