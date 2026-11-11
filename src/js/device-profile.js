/**
 * Display and input defaults for the active badge.
 *
 * The FitPro dial-info query is NOT safe on every BJ/DG badge, so use a
 * verified hardware identity before applying BG02-specific overrides.
 * For other models, prefer reported dimensions and algorithm when present.
 * Unknown badges retain the upstream RGB565 / 360x360 fallback.
 */
import { looksLikeBg02 } from './ru50.js';

export const FALLBACK_SIZE = { width: 360, height: 360 };
const validDimension = (v) => Number.isInteger(Number(v)) && Number(v) >= 16 &&
  Number(v) <= 1024;

export function resolveBadgeProfile(snapshot = {}) {
  const bg02 = looksLikeBg02(snapshot);
  const protocolMode = snapshot?.protocolMode || 'unknown';
  const reportedWidth = validDimension(snapshot?.dialWidth) ? Number(snapshot.dialWidth) : null;
  const reportedHeight = validDimension(snapshot?.dialHeight) ? Number(snapshot.dialHeight) : null;
  const width = bg02 ? 240 : (reportedWidth ?? FALLBACK_SIZE.width);
  const height = bg02 ? 240 : (reportedHeight ?? FALLBACK_SIZE.height);
  const jpeg = protocolMode === 'baji' || Number(snapshot?.dialAlgorithm) === 4;
  const format = bg02 ? 'ru50' : jpeg ? 'jpeg444' : 'rgb565';

  return {
    id: bg02 ? 'bg02' : (protocolMode === 'baji' ? 'baji' : 'fitpro-generic'),
    bg02,
    width,
    height,
    format,
    fixedSize: bg02,
    hasReportedSize: reportedWidth !== null && reportedHeight !== null,
    showMediaLibrary: protocolMode === 'baji',
    showBajiOptions: protocolMode === 'baji',
    fileAccept: bg02 ? 'image/*,.ru50' : 'image/*',
    chooseLabel: bg02 ? 'Choose photo' : 'Choose image',
    formatLabel: bg02
      ? 'BG02 · round 240×240 picture'
      : jpeg ? 'JPEG 4:4:4' : 'RGB565',
    formatHelp: bg02
      ? 'Choose a photo, drag to move it inside the circle, zoom as needed, then upload. The picture is resized and converted automatically.'
      : jpeg
        ? 'Images are cropped to the selected size and encoded as JPEG 4:4:4 before uploading.'
        : 'Images are cropped to the selected size and encoded as RGB565. For badges without reported dimensions, 360×360 is only a fallback.',
  };
}

/**
 * Guard against accidentally uploading a stale image after badge switching.
 * For generic devices, manual width/height controls remain valid.
 */
export function imageMatchesBadge(prepared, profile, snapshot = {}) {
  if (!prepared) return false;
  if (prepared.format !== profile.format) return false;
  if (profile.bg02) {
    return snapshot.protocolMode === 'fitpro' &&
      prepared.width === 240 && prepared.height === 240;
  }
  return true;
}

/**
 * A photo chosen for one device must not silently become upload-ready on a
 * different device. Firmware/profile refreshes within the same session do
 * not trigger this reset, but connecting, switching or disconnecting does.
 */
export function needsFreshPictureSelection(previousSessionId, nextSessionId) {
  return (previousSessionId ?? null) !== (nextSessionId ?? null);
}
