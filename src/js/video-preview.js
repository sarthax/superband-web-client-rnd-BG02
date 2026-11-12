/**
 * BG02 AVI synchronized comparison player.
 *
 * Left: sampled, cropped source frame captured BEFORE JPEG compression.
 * Right: JPEG bitstream extracted from the final AVI the badge will receive.
 * Does NOT use Chrome's unreliable native AVI <video> decoder, and does not
 * change the AVI bytes, the Bluetooth sender or the BG02 playback behavior.
 */
import { extractBg02AviFrames } from './video-avi.js';

export class AviComparisonPreview {
  constructor({ root, sourceCanvas, encodedCanvas, play, previous, next,
    seek, position, description, sourceCaption }) {
    this.els = { root, sourceCanvas, encodedCanvas, play, previous, next,
      seek, position, description, sourceCaption };
    this.sourceCtx = sourceCanvas.getContext('2d', { alpha: false });
    this.encodedCtx = encodedCanvas.getContext('2d', { alpha: false });
    this.reset();
    play.addEventListener('click', () => {
      if (this.playing) this.pause();
      else this.play();
    });
    previous.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    seek.addEventListener('input', () => {
      this.pause();
      void this.show(Number(seek.value));
    });
  }

  reset() {
    this.pause();
    this.generation = (this.generation || 0) + 1;
    this.renderToken = (this.renderToken || 0) + 1;
    if (this.decoded) {
      for (const pending of this.decoded.values()) {
        void pending.then(bitmap => bitmap.close()).catch(() => {});
      }
    }
    if (this.referenceFrames) {
      for (const frame of this.referenceFrames) frame.close();
    }
    this.decoded = new Map();
    this.referenceFrames = null;
    this.jpegFrames = [];
    this.info = null;
    this.index = 0;
    this.els.root.hidden = true;
    this.els.seek.value = '0';
    this.els.seek.max = '0';
    this.els.position.textContent = 'Frame —';
    this.els.description.textContent = '';
    this.sourceCtx.fillStyle = '#000';
    this.sourceCtx.fillRect(0, 0, 240, 240);
    this.encodedCtx.fillStyle = '#000';
    this.encodedCtx.fillRect(0, 0, 240, 240);
  }

  setResult(result) {
    this.reset();
    const jpegFrames = extractBg02AviFrames(result.bytes);
    if (jpegFrames.length !== result.info.frames) {
      throw new Error('AVI preview frame count does not match encoded file');
    }
    this.info = result.info;
    this.jpegFrames = jpegFrames;
    this.referenceFrames = result.referenceFrames || null;
    this.els.seek.min = '0';
    this.els.seek.max = String(jpegFrames.length - 1);
    this.els.seek.step = '1';
    this.els.root.hidden = false;
    this.els.sourceCaption.textContent = this.referenceFrames
      ? 'Source (sampled, before MJPEG compression)'
      : 'Original AVI (already encoded)';
    this.els.description.textContent =
      'Two synchronized views of the same selected frames. The AVI preview ' +
      'decodes the actual embedded JPEGs; playback here follows the AVI header, ' +
      'not verified BG02 hardware timing.';
    void this.show(0);
  }

  pause() {
    this.playing = false;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.els.play.textContent = 'Play preview';
    this.els.play.disabled = !this.info;
  }

  play() {
    if (!this.info || this.playing) return;
    this.playing = true;
    this.els.play.textContent = 'Pause preview';
    void this.tick();
  }

  step(delta) {
    if (!this.info) return;
    this.pause();
    void this.show((this.index + delta + this.jpegFrames.length) %
      this.jpegFrames.length);
  }

  getBitmap(index) {
    if (this.decoded.has(index)) return this.decoded.get(index);
    const token = this.generation;
    const promise = createImageBitmap(
      new Blob([this.jpegFrames[index]], { type: 'image/jpeg' }),
    ).then(bitmap => {
      if (token !== this.generation) {
        bitmap.close();
        throw new Error('Preview no longer active');
      }
      return bitmap;
    });
    this.decoded.set(index, promise);
    return promise;
  }

  async show(index) {
    if (!this.info) return;
    const i = Math.max(0, Math.min(this.jpegFrames.length - 1, Math.floor(index)));
    const token = ++this.renderToken;
    const generation = this.generation;
    try {
      const bitmap = await this.getBitmap(i);
      if (generation !== this.generation || token !== this.renderToken) return;
      const original = this.referenceFrames?.[i] || bitmap;
      this.sourceCtx.drawImage(original, 0, 0, 240, 240);
      this.encodedCtx.drawImage(bitmap, 0, 0, 240, 240);
      this.index = i;
      this.els.seek.value = String(i);
      this.els.position.textContent =
        'Frame ' + (i + 1) + ' / ' + this.jpegFrames.length +
        ' · ' + (i / this.info.fps).toFixed(2) + 's / ' +
        this.info.seconds.toFixed(2) + 's · ' + this.info.fps + ' fps';
    } catch (e) {
      if (generation !== this.generation) return;
      this.pause();
      this.els.position.textContent = 'AVI JPEG preview unavailable: ' + e.message;
    }
  }

  async tick() {
    if (!this.playing || !this.info) return;
    const start = performance.now();
    const current = this.index;
    await this.show(current);
    if (!this.playing || !this.info) return;
    // Browser preview follows AVI header pacing. Slow JPEG decoding can delay
    // playback; show both comparisons together rather than out of sync.
    const duration = 1000 / this.info.fps;
    this.index = (current + 1) % this.jpegFrames.length;
    this.timer = setTimeout(() => void this.tick(),
      Math.max(20, duration - (performance.now() - start)));
  }
}
