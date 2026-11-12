/**
 * Two explicit BG02 still-image encoders for offline A/B quality comparison.
 * Neither method sends anything to the badge; return exactly the bytes that
 * will later be transferred via Dial31 type 0 (RU50) or type 2 (JPEG).
 */
import { encodeImageDataRu50, inspectRu50, RU50_HEADER_SIZE } from './ru50.js';
import { encodeBaselineJpeg444, describeJpeg } from './jpeg444.js';
import { decodeEtc2IndividualRgb } from './etc2.js';

export const BG02_JPEG_DEFAULT_QUALITY = 65;
export const BG02_JPEG_MIN_QUALITY = 35;
export const BG02_JPEG_MAX_QUALITY = 90;

export function validateBg02Jpeg(bytes) {
  const info = describeJpeg(bytes);
  if (!info.ok || info.width !== 240 || info.height !== 240 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('BG02 JPEG must be complete 240x240 baseline JFIF, YCbCr 4:4:4');
  }
  return info;
}

export async function prepareBg02PictureComparison(imageData, {
  jpegQuality = BG02_JPEG_DEFAULT_QUALITY,
} = {}) {
  if (!imageData || imageData.width !== 240 || imageData.height !== 240 ||
      !imageData.data || imageData.data.length !== 240 * 240 * 4) {
    throw new Error('Both BG02 formats require a final 240x240 crop');
  }
  if (!Number.isInteger(jpegQuality) || jpegQuality < BG02_JPEG_MIN_QUALITY ||
      jpegQuality > BG02_JPEG_MAX_QUALITY) {
    throw new Error('Experimental JPEG quality must be 35–90');
  }

  const jpegBytes = encodeBaselineJpeg444(imageData, { quality: jpegQuality });
  const jpegInfo = validateBg02Jpeg(jpegBytes);
  const ru50Bytes = await encodeImageDataRu50(imageData);
  inspectRu50(ru50Bytes);
  const ru50Pixels = decodeEtc2IndividualRgb(
    ru50Bytes.subarray(RU50_HEADER_SIZE), 240, 240,
  );

  return {
    jpegQuality,
    sourcePixels: imageData,
    ru50: { format: 'ru50', bytes: ru50Bytes, pixels: ru50Pixels },
    jpeg: { format: 'jpeg444', bytes: jpegBytes, jpegInfo },
  };
}
