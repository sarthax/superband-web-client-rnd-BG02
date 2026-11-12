/**
 * Optimize a BG02 240x240 baseline JPEG for the badge's observed 8 KiB
 * media-allocation granularity. File bytes + the Dial31 length field (4 B)
 * must BOTH fit: a 16 KiB allocation admits at most 16,380 JPEG bytes.
 *
 * IMPORTANT: sizes are always measured from actual encoded bytes. JPEG size
 * is not guaranteed to increase monotonically with quality, so a descending
 * search (rather than a binary-search assumption) finds the highest allowed
 * quality exactly. Yield occasionally to keep the UI responsive.
 */
import { encodeBaselineJpeg444 } from './jpeg444.js';
import {
  BG02_JPEG_MIN_QUALITY, BG02_JPEG_MAX_QUALITY, validateBg02Jpeg,
} from './picture-comparison.js';
import { BG02_STORAGE_ROUNDING_HINT } from './picture-size.js';

export const BG02_JPEG_WRAPPER_BYTES = 4;
export const BG02_JPEG_ALLOCATION_STEP = BG02_STORAGE_ROUNDING_HINT;

export function jpegAllocationSummary(encodedBytes) {
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes <= 0)
    throw new Error('JPEG byte size must be a positive integer');
  const transferred = encodedBytes + BG02_JPEG_WRAPPER_BYTES;
  const allocation = Math.ceil(transferred / BG02_JPEG_ALLOCATION_STEP) *
    BG02_JPEG_ALLOCATION_STEP;
  return {
    encodedBytes,
    transferredBytes: transferred,
    allocationBytes: allocation,
    headroomBytes: allocation - transferred,
  };
}

export function jpegTargetAllocation(encodedBytes, change = 0) {
  if (!Number.isInteger(change) || change < -1 || change > 1)
    throw new Error('Choose same, previous or next 8 KiB allocation block');
  const target = jpegAllocationSummary(encodedBytes).allocationBytes +
    change * BG02_JPEG_ALLOCATION_STEP;
  if (target < BG02_JPEG_ALLOCATION_STEP)
    throw new Error('There is no smaller allocation than 8 KiB');
  return target;
}

export async function optimizeJpegAllocation(imageData, targetBytes, {
  minQuality = BG02_JPEG_MIN_QUALITY,
  maxQuality = BG02_JPEG_MAX_QUALITY,
  checkCurrent = null,
  onTrial = null,
} = {}) {
  if (imageData?.width !== 240 || imageData?.height !== 240 ||
      imageData?.data?.length !== 240 * 240 * 4) {
    throw new Error('Allocation optimizer requires a 240×240 source crop');
  }
  if (!Number.isSafeInteger(targetBytes) ||
      targetBytes < BG02_JPEG_ALLOCATION_STEP ||
      targetBytes % BG02_JPEG_ALLOCATION_STEP !== 0) {
    throw new Error('Allocation target must be a positive multiple of 8 KiB');
  }
  if (!Number.isInteger(minQuality) || !Number.isInteger(maxQuality) ||
      minQuality < BG02_JPEG_MIN_QUALITY ||
      maxQuality > BG02_JPEG_MAX_QUALITY || maxQuality < minQuality) {
    throw new Error('Invalid quality range');
  }

  let smallest = null;
  let trials = 0;
  // Search from best visual quality downwards. Never assume a larger quality
  // produces a larger JPEG, as quantization/Huffman output can have reversals.
  for (let quality = maxQuality; quality >= minQuality; quality--) {
    if (checkCurrent && !checkCurrent())
      throw new Error('Image or crop changed during JPEG optimization');
    const bytes = encodeBaselineJpeg444(imageData, { quality });
    trials++;
    onTrial?.({ quality, trials, encodedBytes: bytes.length, targetBytes });
    if (!smallest || bytes.length < smallest.encodedBytes) {
      smallest = { quality, encodedBytes: bytes.length };
    }
    if (bytes.length + BG02_JPEG_WRAPPER_BYTES <= targetBytes) {
      const info = validateBg02Jpeg(bytes);
      return {
        fits: true, quality, bytes, info, trials,
        targetBytes,
        ...jpegAllocationSummary(bytes.length),
        targetHeadroomBytes: targetBytes - bytes.length - BG02_JPEG_WRAPPER_BYTES,
      };
    }
    // A target that is impossible at quality 35 may need 56 candidate encodes.
    // Let Chrome repaint/status-update, and allow cancellation between trials.
    if (trials % 3 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return {
    fits: false, targetBytes, trials, minimumSize: smallest,
  };
}
