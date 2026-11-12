/**
 * BG02 picture size/space estimator. No Bluetooth traffic and no image rewrite.
 * RU50/ETC2 is fixed-size for 240x240: header 1104 + ETC2 RGB 28800.
 * That is the exact encoded byte count, not the original JPG/PNG size.
 */
import { RU50_HEADER_SIZE } from './ru50.js';

export const BG02_PICTURE_SIZE = 240 * 240 / 2 + RU50_HEADER_SIZE;
export const BG02_STORAGE_ROUNDING_HINT = 8192;

export function estimatePictureStorage({
  bg02 = true, encodedBytes = null, sourceBytes = null,
  availableBytes = null,
} = {}) {
  const bytes = bg02 ? BG02_PICTURE_SIZE : Number(encodedBytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
  // Dial31 wraps media bytes with a BE32 length, which may contribute to
  // logical allocation; physical allocation has not been independently mapped.
  const dial31Bytes = bytes + (bg02 ? 4 : 0);
  const allocationHint = bg02
    ? Math.ceil(dial31Bytes / BG02_STORAGE_ROUNDING_HINT) * BG02_STORAGE_ROUNDING_HINT
    : null;
  const validFree = Number.isSafeInteger(availableBytes) && availableBytes >= 0;
  const freeAfterHint = validFree && allocationHint != null
    ? Math.max(0, availableBytes - allocationHint) : null;
  return {
    sourceBytes: Number.isSafeInteger(sourceBytes) ? sourceBytes : null,
    encodedBytes: bytes, transferredBytes: dial31Bytes, allocationHint,
    availableBytes: validFree ? availableBytes : null,
    freeAfterHint,
    fits: validFree && allocationHint != null ? allocationHint <= availableBytes : null,
  };
}
