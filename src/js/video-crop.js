/**
 * Shared 240x240 crop math for BG02 GIF/video frames.
 *
 * Same bounded pan/zoom geometry as the normal CircleCropEditor, but coordinates
 * are stored at the FINAL AVI resolution (240px) so changing the editor or
 * thumbnail display size never changes the encoded framing.
 *
 * One shared crop is the fallback; selected GIF frames can override it.
 * The badge stores square 240x240 JPEG frames; the circular canvas display
 * mask is CSS-only, just as in the existing picture cropper.
 */
export const VIDEO_CROP_SIZE = 240;
export const VIDEO_CROP_MIN_ZOOM = 1;
export const VIDEO_CROP_MAX_ZOOM = 4;

export function defaultVideoCrop() {
  return { zoom: 1, offsetX: 0, offsetY: 0 };
}

/** Resolve the SAME shared/individual source frame crop for UI and AVI. */
export function resolveVideoFrameCrop(shared, overrides, frameIndex) {
  if (frameIndex == null) return shared;
  const override = overrides instanceof Map
    ? overrides.get(frameIndex) : overrides?.[frameIndex];
  return override || shared;
}

export function copyVideoCrop(crop = defaultVideoCrop()) {
  return {
    zoom: Number(crop.zoom),
    offsetX: Number(crop.offsetX),
    offsetY: Number(crop.offsetY),
  };
}

export function videoCropGeometry(
  sourceW, sourceH, crop = defaultVideoCrop(), fit = 'cover',
  size = VIDEO_CROP_SIZE,
) {
  if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) ||
      sourceW <= 0 || sourceH <= 0 || !Number.isFinite(size) || size <= 0) {
    throw new Error('Video crop requires positive source and canvas dimensions');
  }
  if (fit !== 'cover' && fit !== 'contain') {
    throw new Error('Unknown video crop fit');
  }
  const zoom = Math.min(VIDEO_CROP_MAX_ZOOM,
    Math.max(VIDEO_CROP_MIN_ZOOM, Number(crop?.zoom) || 1));
  const baseScale = (fit === 'cover' ? Math.max : Math.min)(
    size / sourceW, size / sourceH,
  );
  const scale = baseScale * zoom;
  const width = sourceW * scale;
  const height = sourceH * scale;
  // If the image is wider than the viewport, move within its cropped edges.
  // If it is smaller (contain), move only within the available letterbox space.
  const limitX = Math.abs(width - size) / 2;
  const limitY = Math.abs(height - size) / 2;
  const offsetX = Math.max(-limitX, Math.min(limitX,
    Number.isFinite(Number(crop?.offsetX)) ? Number(crop.offsetX) : 0));
  const offsetY = Math.max(-limitY, Math.min(limitY,
    Number.isFinite(Number(crop?.offsetY)) ? Number(crop.offsetY) : 0));
  return {
    scale, drawWidth: width, drawHeight: height,
    drawX: (size - width) / 2 + offsetX,
    drawY: (size - height) / 2 + offsetY,
    zoom, offsetX, offsetY,
  };
}

export function clampVideoCrop(crop, sourceW, sourceH, fit = 'cover') {
  const g = videoCropGeometry(sourceW, sourceH, crop, fit);
  return { zoom: g.zoom, offsetX: g.offsetX, offsetY: g.offsetY };
}

export function panVideoCrop(crop, dx, dy, sourceW, sourceH, fit = 'cover') {
  return clampVideoCrop({
    ...crop,
    offsetX: Number(crop.offsetX) + dx,
    offsetY: Number(crop.offsetY) + dy,
  }, sourceW, sourceH, fit);
}

/** Zoom around a point in 240px preview coordinates, preserving that focal point. */
export function zoomVideoCrop(
  crop, nextZoom, sourceW, sourceH, fit = 'cover', focalX = 120, focalY = 120,
) {
  const old = videoCropGeometry(sourceW, sourceH, crop, fit);
  const fresh = videoCropGeometry(sourceW, sourceH,
    { zoom: nextZoom, offsetX: 0, offsetY: 0 }, fit);
  const imageX = (focalX - old.drawX) / old.scale;
  const imageY = (focalY - old.drawY) / old.scale;
  return clampVideoCrop({
    zoom: fresh.zoom,
    offsetX: focalX - imageX * fresh.scale - (VIDEO_CROP_SIZE - fresh.drawWidth) / 2,
    offsetY: focalY - imageY * fresh.scale - (VIDEO_CROP_SIZE - fresh.drawHeight) / 2,
  }, sourceW, sourceH, fit);
}

/**
 * Draws the EXACT same crop into both the 240px AVI encode canvas and scaled
 * thumbnails. Canvas should be square; no circle mask is encoded in MJPEG.
 */
export function drawVideoCrop(ctx, picture, sourceW, sourceH,
  crop = defaultVideoCrop(), fit = 'cover') {
  const size = ctx.canvas.width;
  if (!size || ctx.canvas.height !== size) throw new Error('Crop canvas must be square');
  const g = videoCropGeometry(sourceW, sourceH, crop, fit);
  const factor = size / VIDEO_CROP_SIZE;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(picture, g.drawX * factor, g.drawY * factor,
    g.drawWidth * factor, g.drawHeight * factor);
  ctx.restore();
}
