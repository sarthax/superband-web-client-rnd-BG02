/**
 * BG02 video/GIF crop editor.
 *
 * - One shared fallback pan/zoom for the entire source.
 * - Selected original GIF frames may each override that crop.
 * - "Apply to selected" copies the active crop to all selected frames.
 * - Crops use the same final 240px geometry for editor, thumbnails, AVI.
 * - No changes to the picture cropper or FitPro transfer path.
 */
import {
  defaultVideoCrop, copyVideoCrop, clampVideoCrop, panVideoCrop,
  zoomVideoCrop, drawVideoCrop, resolveVideoFrameCrop, VIDEO_CROP_SIZE,
} from './video-crop.js';

export class VideoCropEditor {
  constructor({ $, selectedFrames, getFit, canEdit, onChanged, onThumbsDirty,
    previewVideo = null }) {
    this.els = {
      root: $('#videoCropEditor'),
      canvas: $('#videoCropCanvas'),
      zoom: $('#videoCropZoom'),
      zoomLabel: $('#videoCropZoomValue'),
      prev: $('#videoCropPrev'),
      next: $('#videoCropNext'),
      label: $('#videoCropFrameLabel'),
      modeShared: $('#videoCropModeShared'),
      modeFrame: $('#videoCropModeFrame'),
      resetFrame: $('#videoCropResetFrame'),
      useShared: $('#videoCropUseShared'),
      applyAll: $('#videoCropApplyAll'),
      applyEvery: $('#videoCropApplyEvery'),
      resetAll: $('#videoCropResetAll'),
      hint: $('#videoCropHint'),
      frameGrid: $('#gifFrameGrid'),
    };
    this.previewVideo = previewVideo;
    this.selectedFrames = selectedFrames;
    this.getFit = getFit;
    this.canEdit = canEdit;
    this.onChanged = onChanged;
    this.onThumbsDirty = onThumbsDirty;
    this.ctx = this.els.canvas.getContext('2d', { alpha: false });
    this.pointers = new Map();
    this.lastPinchDistance = null;
    this.thumbTimer = null;
    this.renderToken = 0;
    this.cached = null;
    this.disabled = false;
    this.clear();
    this.bind();
  }

  clearCachedImage() {
    this.renderToken++;
    if (this.cached) this.cached.image.close();
    this.cached = null;
  }

  clear() {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = null;
    this.clearCachedImage();
    this.source = null;
    this.shared = defaultVideoCrop();
    this.overrides = new Map();
    this.active = 0;
    this.mode = 'shared';
    this.pointers.clear();
    this.lastPinchDistance = null;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, VIDEO_CROP_SIZE, VIDEO_CROP_SIZE);
    this.updateControls();
  }

  setSource(source) {
    this.clear();
    this.source = source?.kind === 'avi' ? null : source;
    this.els.root.hidden = !this.source;
    this.updateControls();
    void this.render();
  }

  setDisabled(disabled) {
    if (this.disabled === Boolean(disabled)) return;
    this.disabled = Boolean(disabled);
    this.updateControls();
    this.syncFrameCards();
  }

  snapshot() {
    return {
      sharedCrop: copyVideoCrop(this.shared),
      frameCropOverrides: new Map(
        [...this.overrides].map(([i, crop]) => [i, copyVideoCrop(crop)]),
      ),
    };
  }

  /** Restore a validated source's crop settings (never uploads or edits media). */
  restore(saved) {
    if (!this.source) return;
    if (!saved || !saved.sharedCrop || !Array.isArray(saved.frameCropOverrides))
      throw new Error('Invalid saved video/GIF framing');
    const restoreOne = (crop) => {
      if (![crop?.zoom, crop?.offsetX, crop?.offsetY].every(Number.isFinite))
        throw new Error('Invalid saved frame crop');
      return clampVideoCrop(crop, this.source.width, this.source.height, this.getFit());
    };
    this.shared = restoreOne(saved.sharedCrop);
    this.overrides.clear();
    for (const [index, crop] of saved.frameCropOverrides) {
      if (this.source.kind !== 'gif') break;
      if (!Number.isInteger(index) || index < 0 || index >= this.source.ends.length)
        throw new Error('Saved GIF crop index is outside source');
      this.overrides.set(index, restoreOne(crop));
    }
    this.active = 0;
    this.mode = 'shared';
    this.clearCachedImage();
    this.updateControls();
    this.syncFrameCards();
    void this.render();
    this.scheduleThumbs();
  }

  cropForFrame(index) {
    return resolveVideoFrameCrop(this.shared, this.overrides, index);
  }

  selected() {
    return [...this.selectedFrames].sort((a, b) => a - b);
  }

  canEditFrame() {
    return this.source?.kind === 'gif' && this.selectedFrames.has(this.active);
  }

  editingFrame() {
    return this.mode === 'frame' && this.canEditFrame();
  }

  currentCrop() {
    return this.editingFrame() ? this.cropForFrame(this.active) : this.shared;
  }

  setActiveFrame(index, frameMode = true) {
    if (this.source?.kind !== 'gif' ||
        !Number.isInteger(index) || index < 0 || index >= this.source.ends.length) return;
    if (index !== this.active) this.clearCachedImage();
    this.active = index;
    if (frameMode && this.selectedFrames.has(index)) this.mode = 'frame';
    this.updateControls();
    this.syncFrameCards();
    void this.render();
  }

  onSelectionChanged() {
    const selected = this.selected();
    if (!selected.length) {
      this.mode = 'shared';
      this.setActiveFrame(0, false);
    } else if (!this.selectedFrames.has(this.active)) {
      this.setActiveFrame(selected[0], true);
    }
    this.updateControls();
    this.syncFrameCards();
  }

  setMode(next) {
    if (next === 'frame' && !this.canEditFrame()) return;
    if (next !== 'shared' && next !== 'frame') return;
    this.mode = next;
    this.updateControls();
    void this.render();
  }

  setCrop(crop, refreshThumbs = false) {
    if (!this.source || !this.canEdit()) return;
    const next = clampVideoCrop(crop, this.source.width, this.source.height,
      this.getFit());
    const previous = this.currentCrop();
    if (Math.abs(previous.zoom - next.zoom) < 1e-7 &&
        Math.abs(previous.offsetX - next.offsetX) < 1e-5 &&
        Math.abs(previous.offsetY - next.offsetY) < 1e-5) return;
    if (this.editingFrame()) this.overrides.set(this.active, next);
    else this.shared = next;
    this.onChanged();
    this.updateControls();
    void this.render();
    if (refreshThumbs) this.scheduleThumbs();
  }

  scheduleThumbs() {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      this.thumbTimer = null;
      if (this.source?.kind === 'gif') this.onThumbsDirty();
    }, 170);
  }

  resetCurrent() {
    if (!this.source || !this.canEdit()) return;
    if (this.editingFrame()) this.overrides.set(this.active, defaultVideoCrop());
    else this.shared = defaultVideoCrop();
    this.onChanged();
    this.updateControls();
    void this.render();
    this.scheduleThumbs();
  }

  useShared() {
    if (!this.canEditFrame() || !this.canEdit()) return;
    this.overrides.delete(this.active);
    this.onChanged();
    this.updateControls();
    void this.render();
    this.scheduleThumbs();
  }

  applyAllSelected() {
    const selected = this.selected();
    if (!this.source || this.source.kind !== 'gif' ||
        !selected.length || !this.canEdit()) return;
    const reference = copyVideoCrop(this.currentCrop());
    for (const index of selected) this.overrides.set(index, copyVideoCrop(reference));
    this.onChanged();
    this.updateControls();
    this.syncFrameCards();
    this.scheduleThumbs();
  }

  applyToEveryFrame() {
    if (!this.source || this.source.kind !== 'gif' || !this.canEdit()) return;
    // O(1) for even 1,500-frame GIFs: use the current framing as the shared
    // default and remove individual overrides. No giant per-frame map needed.
    this.shared = copyVideoCrop(this.currentCrop());
    this.overrides.clear();
    this.mode = 'shared';
    this.onChanged();
    this.updateControls();
    this.syncFrameCards();
    void this.render();
    this.scheduleThumbs();
  }

  resetAll() {
    if (!this.source || !this.canEdit()) return;
    this.shared = defaultVideoCrop();
    this.overrides.clear();
    this.mode = 'shared';
    this.onChanged();
    this.updateControls();
    this.syncFrameCards();
    void this.render();
    this.scheduleThumbs();
  }

  nextSelected(direction) {
    const selected = this.selected();
    if (!selected.length) return;
    let i = selected.indexOf(this.active);
    if (i < 0) i = 0;
    else i = (i + direction + selected.length) % selected.length;
    this.setActiveFrame(selected[i], true);
  }

  syncFrameCards() {
    this.els.frameGrid.querySelectorAll('.gif-frame-card').forEach(button => {
      const index = Number(button.dataset.frameIndex);
      button.dataset.editing = String(this.source?.kind === 'gif' &&
        this.active === index);
      button.dataset.override = String(this.overrides.has(index));
      const edit = button.closest('.gif-frame-tile')?.querySelector('.gif-frame-edit');
      if (edit) edit.disabled = !this.selectedFrames.has(index) ||
        this.disabled || !this.canEdit();
    });
  }

  updateControls() {
    const { root, zoom, zoomLabel, prev, next, label,
      modeShared, modeFrame, resetFrame, useShared, applyAll,
      applyEvery, resetAll, hint, canvas } = this.els;
    const ready = Boolean(this.source);
    const gif = this.source?.kind === 'gif';
    const selectedCount = this.selectedFrames.size;
    const activeIsSelected = this.canEditFrame();
    root.hidden = !ready;
    const interactive = ready && !this.disabled && this.canEdit();
    for (const el of [zoom, resetFrame, resetAll]) el.disabled = !interactive;
    prev.disabled = next.disabled = !interactive || !gif || selectedCount < 2;
    modeShared.disabled = !interactive;
    modeFrame.disabled = !interactive || !activeIsSelected;
    useShared.disabled = !interactive || !activeIsSelected ||
      !this.overrides.has(this.active);
    applyAll.disabled = !interactive || !gif || !selectedCount;
    applyEvery.disabled = !interactive || !gif;
    canvas.style.pointerEvents = interactive ? 'auto' : 'none';
    modeShared.setAttribute('aria-pressed', String(this.mode === 'shared'));
    modeFrame.setAttribute('aria-pressed', String(this.editingFrame()));
    const crop = this.currentCrop();
    zoom.value = String(Math.round(crop.zoom * 100));
    zoomLabel.textContent = Math.round(crop.zoom * 100) + '%';
    if (!ready) {
      label.textContent = 'No video or GIF selected.';
      hint.textContent = '';
    } else if (gif) {
      label.textContent = 'GIF frame #' + (this.active + 1) + ' of ' +
        this.source.ends.length + ' · ' +
        (this.editingFrame() ? (
          this.overrides.has(this.active) ? 'Individual crop override' :
          'Individual frame (inherits shared crop until changed)'
        ) : 'Editing shared crop');
      hint.textContent = 'The shared crop applies wherever no individual frame ' +
        'override exists. ' + selectedCount + ' GIF frames selected.';
    } else {
      label.textContent = 'Video · shared crop for every sampled frame';
      hint.textContent = 'Video clips use one shared pan/zoom setting.';
    }
  }

  async render() {
    const source = this.source;
    const token = ++this.renderToken;
    if (!source) return;
    try {
      let picture;
      if (source.kind === 'gif') {
        if (this.cached?.source === source && this.cached.index === this.active) {
          picture = this.cached.image;
        } else {
          const { image } = await source.decoder.decode({ frameIndex: this.active });
          if (token !== this.renderToken || source !== this.source) {
            image.close();
            return;
          }
          this.clearCachedImage();
          this.cached = { source, index: this.active, image };
          picture = image;
        }
      } else {
        picture = this.previewVideo?.readyState >= 2
          ? this.previewVideo : source.video;
        if (!picture || picture.readyState < 2) return;
      }
      if (source !== this.source) return;
      drawVideoCrop(this.ctx, picture, source.width, source.height,
        this.currentCrop(), this.getFit());
    } catch (e) {
      if (source === this.source && token === this.renderToken) {
        this.els.hint.textContent = 'Crop preview unavailable: ' + e.message;
      }
    }
  }

  point(event) {
    const rect = this.els.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * VIDEO_CROP_SIZE / rect.width,
      y: (event.clientY - rect.top) * VIDEO_CROP_SIZE / rect.height,
    };
  }

  pointerDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  }

  bind() {
    const e = this.els;
    e.zoom.addEventListener('input', () => {
      if (!this.source || !this.canEdit()) return;
      this.setCrop(zoomVideoCrop(this.currentCrop(), Number(e.zoom.value) / 100,
        this.source.width, this.source.height, this.getFit()));
    });
    e.zoom.addEventListener('change', () => this.scheduleThumbs());
    e.modeShared.addEventListener('click', () => this.setMode('shared'));
    e.modeFrame.addEventListener('click', () => this.setMode('frame'));
    e.resetFrame.addEventListener('click', () => this.resetCurrent());
    e.useShared.addEventListener('click', () => this.useShared());
    e.applyAll.addEventListener('click', () => this.applyAllSelected());
    e.applyEvery.addEventListener('click', () => this.applyToEveryFrame());
    e.resetAll.addEventListener('click', () => this.resetAll());
    e.prev.addEventListener('click', () => this.nextSelected(-1));
    e.next.addEventListener('click', () => this.nextSelected(1));

    e.canvas.addEventListener('pointerdown', event => {
      if (!this.source || !this.canEdit()) return;
      event.preventDefault();
      e.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, this.point(event));
      this.lastPinchDistance = this.pointers.size === 2 ? this.pointerDistance() : null;
    });
    e.canvas.addEventListener('pointermove', event => {
      if (!this.source || !this.canEdit() || !this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      const next = this.point(event);
      const previous = this.pointers.get(event.pointerId);
      this.pointers.set(event.pointerId, next);
      if (this.pointers.size >= 2) {
        const distance = this.pointerDistance();
        if (this.lastPinchDistance && distance) {
          this.setCrop(zoomVideoCrop(this.currentCrop(),
            this.currentCrop().zoom * distance / this.lastPinchDistance,
            this.source.width, this.source.height, this.getFit()));
        }
        this.lastPinchDistance = distance;
      } else {
        this.setCrop(panVideoCrop(this.currentCrop(), next.x - previous.x,
          next.y - previous.y, this.source.width, this.source.height, this.getFit()));
      }
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      e.canvas.addEventListener(name, event => {
        if (!this.pointers.has(event.pointerId)) return;
        this.pointers.delete(event.pointerId);
        if (this.pointers.size < 2) this.lastPinchDistance = null;
        this.scheduleThumbs();
      });
    }
    e.canvas.addEventListener('wheel', event => {
      if (!this.source || !this.canEdit()) return;
      event.preventDefault();
      const at = this.point(event);
      const zoom = this.currentCrop().zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12);
      this.setCrop(zoomVideoCrop(this.currentCrop(), zoom, this.source.width,
        this.source.height, this.getFit(), at.x, at.y));
      this.scheduleThumbs();
    }, { passive: false });
    e.canvas.addEventListener('keydown', event => {
      if (!this.source || !this.canEdit()) return;
      const steps = { ArrowLeft: [-4, 0], ArrowRight: [4, 0],
        ArrowUp: [0, -4], ArrowDown: [0, 4] };
      if (steps[event.key]) {
        event.preventDefault();
        const [x, y] = steps[event.key];
        this.setCrop(panVideoCrop(this.currentCrop(), x, y, this.source.width,
          this.source.height, this.getFit()), true);
      }
    });
  }
}
