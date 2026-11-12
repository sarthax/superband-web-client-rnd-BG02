/**
 * Choose AVI storage targets from REAL encoded file sizes. Eight-kibibyte
 * allocation rounding is an empirical BG02 observation, not proven flash geometry.
 * Video has no quality scalar: the browser supports three JPEG presets.
 */
import { estimateVideoAllocation, BG02_VIDEO } from './video-avi.js';

export function videoAllocationTarget(aviBytes, change = 0) {
  if (!Number.isSafeInteger(aviBytes) || aviBytes <= 0)
    throw new Error('AVI size must be measured before selecting storage budget');
  if (![0,-1,1].includes(change))
    throw new Error('Unknown video allocation target');
  const target = estimateVideoAllocation(aviBytes) +
    change * BG02_VIDEO.ALLOCATION_HINT_BYTES;
  if (target < BG02_VIDEO.ALLOCATION_HINT_BYTES)
    throw new Error('A video cannot fit a smaller-than-8KiB allocation');
  return target;
}

export function videoOptimizationProfiles(fps, compareOneAndThree = false) {
  if (![.5,1,2,3].includes(fps))throw new Error('Unsupported BG02 video FPS');
  const rates = compareOneAndThree ?
    [...new Set([fps,3,1])] : [fps];
  return rates.flatMap(rate =>
    ['high','medium','low'].map(quality => ({fps:rate,quality})));
}

export function chooseVideoOptimizationResult(candidates, budget, preferredFps) {
  if (!Number.isInteger(budget) || budget < 8192 || budget % 8192)
    throw new Error('Invalid AVI allocation budget');
  const fits = candidates.filter(c => c?.result?.bytes?.length > 0 &&
    c.result.bytes.length + 4 <= budget);
  if (!fits.length)return null;
  const qualityRank = {high:0,medium:1,low:2};
  return [...fits].sort((a,b)=>{
    // Preserve the user's chosen FPS whenever it can fit; only lower frame
    // rate automatically when the current one cannot fit the block.
    const ar=a.fps===preferredFps?0:1;
    const br=b.fps===preferredFps?0:1;
    return ar-br || b.fps-a.fps ||
      qualityRank[a.quality]-qualityRank[b.quality] ||
      a.result.bytes.length-b.result.bytes.length;
  })[0];
}
