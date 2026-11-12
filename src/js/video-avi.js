/**
 * BG02 experimental MJPEG/AVI writer.
 *
 * Recovered SuperBand video is RIFF/AVI, 'mjpg' codec, 240x240, 3 fps.
 * This builds ordinary AVI 1.0 (hdrl + movi + idx1) without ffmpeg.wasm.
 * The codec/container is evidenced; stock BG02 compatibility of browser-JPEG
 * frames and clips longer than five seconds still requires a hardware test.
 */
export const BG02_VIDEO = Object.freeze({
  WIDTH: 240,
  HEIGHT: 240,
  FPS: 3,
  EXPERIMENTAL_FPS: Object.freeze([2, 1, 0.5]),
  VERIFIED_SECONDS: 5,
  MAX_EXPERIMENTAL_SECONDS: 30,
  ALLOCATION_HINT_BYTES: 8192, // inferred from one 29,904B file using 32KiB
});

const fourCC = (bytes, at, text) => {
  for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
};
const ascii = (b, at) => String.fromCharCode(...b.subarray(at, at + 4));
const u16 = (v, at, n) => v.setUint16(at, n, true);
const u32 = (v, at, n) => v.setUint32(at, n >>> 0, true);

export function bg02AviTimebase(fps) {
  // Use exact rational values, never write fractional values to AVI DWORDs.
  // The only recovered SuperBand AVI used 3fps. Lower rates are unverified.
  if (fps === 0.5) return { rate: 1, scale: 2 };
  if (fps === 1 || fps === 2 || fps === 3) return { rate: fps, scale: 1 };
  throw new Error('BG02 supports 3fps format; 2, 1 and 0.5fps are experimental');
}

function concat(parts) {
  const count = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(count);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function riffChunk(tag, payload) {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1));
  fourCC(out, 0, tag);
  u32(new DataView(out.buffer), 4, payload.length);
  out.set(payload, 8);
  return out;
}

function listChunk(kind, chunks) {
  const head = new Uint8Array(4);
  fourCC(head, 0, kind);
  return riffChunk('LIST', concat([head, ...chunks]));
}

function aviHeader({ width, height, fps, frames, maxFrame }) {
  const out = new Uint8Array(56);
  const v = new DataView(out.buffer);
  u32(v, 0, Math.round(1_000_000 / fps));
  u32(v, 4, Math.ceil(maxFrame * fps));
  u32(v, 8, 0);
  u32(v, 12, 0x10); // AVIF_HASINDEX
  u32(v, 16, frames);
  u32(v, 20, 0);
  u32(v, 24, 1); // one video stream
  u32(v, 28, maxFrame);
  u32(v, 32, width);
  u32(v, 36, height);
  return riffChunk('avih', out);
}

function streamHeader({ width, height, fps, frames, maxFrame }) {
  const out = new Uint8Array(56);
  const v = new DataView(out.buffer);
  fourCC(out, 0, 'vids');
  fourCC(out, 4, 'mjpg');
  u32(v, 8, 0);
  u16(v, 12, 0);
  u16(v, 14, 0);
  u32(v, 16, 0);
  const { rate, scale } = bg02AviTimebase(fps);
  u32(v, 20, scale); // dwScale
  u32(v, 24, rate); // dwRate
  u32(v, 28, 0);
  u32(v, 32, frames);
  u32(v, 36, maxFrame);
  u32(v, 40, 0xffffffff); // quality unspecified
  u32(v, 44, 0);
  u16(v, 48, 0);
  u16(v, 50, 0);
  u16(v, 52, width);
  u16(v, 54, height);
  return riffChunk('strh', out);
}

function streamFormat({ width, height, maxFrame }) {
  const out = new Uint8Array(40);
  const v = new DataView(out.buffer);
  u32(v, 0, 40); // BITMAPINFOHEADER
  u32(v, 4, width);
  u32(v, 8, height);
  u16(v, 12, 1);
  u16(v, 14, 24);
  fourCC(out, 16, 'mjpg');
  u32(v, 20, Math.max(maxFrame, width * height * 3));
  return riffChunk('strf', out);
}

/** Output AVI bytes, not a zip. The actual length is the exact encoded size. */
export function muxBg02MjpegAvi(jpegFrames, {
  width = BG02_VIDEO.WIDTH,
  height = BG02_VIDEO.HEIGHT,
  fps = BG02_VIDEO.FPS,
} = {}) {
  if (!Number.isInteger(width) || width !== 240 || height !== 240 ||
      ![3, 2, 1, 0.5].includes(fps) ||
      !Array.isArray(jpegFrames) || jpegFrames.length < 1 ||
      jpegFrames.length / fps > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS) {
    throw new Error('BG02 AVI requires 240x240 MJPEG, 0.5/1/2/3fps, maximum 30 seconds');
  }
  let maxFrame = 0;
  for (const f of jpegFrames) {
    if (!(f instanceof Uint8Array) || f.length < 100 ||
        f[0] !== 0xff || f[1] !== 0xd8 ||
        f[f.length - 2] !== 0xff || f[f.length - 1] !== 0xd9) {
      throw new Error('AVI frames must be complete JPEG byte arrays');
    }
    maxFrame = Math.max(maxFrame, f.length);
  }
  const args = { width, height, fps, frames: jpegFrames.length, maxFrame };
  const hdrl = listChunk('hdrl', [
    aviHeader(args),
    listChunk('strl', [streamHeader(args), streamFormat(args)]),
  ]);
  const moviChunks = jpegFrames.map((f) => riffChunk('00dc', f));
  const movi = listChunk('movi', moviChunks);
  const index = new Uint8Array(jpegFrames.length * 16);
  const idx = new DataView(index.buffer);
  let frameOffset = 4; // relative to the 'movi' FOURCC, as in stock FFmpeg AVI
  for (let i = 0; i < jpegFrames.length; i++) {
    const at = i * 16;
    fourCC(index, at, '00dc');
    u32(idx, at + 4, 0x10); // keyframe
    u32(idx, at + 8, frameOffset);
    u32(idx, at + 12, jpegFrames[i].length);
    frameOffset += moviChunks[i].length;
  }
  const payload = concat([
    Uint8Array.from([65, 86, 73, 32]), // AVI<space>
    hdrl,
    movi,
    riffChunk('idx1', index),
  ]);
  return riffChunk('RIFF', payload);
}

/** Inspect enough of an AVI to prevent accidentally sending unrelated files. */
export function inspectBg02MjpegAvi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 200 || ascii(b, 0) !== 'RIFF' || ascii(b, 8) !== 'AVI ') {
    throw new Error('Not a RIFF AVI file');
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const read = (o) => view.getUint32(o, true);
  if (read(4) + 8 > b.length) throw new Error('Incomplete AVI file');
  let width = 0, height = 0, fps = 0, declaredFrames = 0, foundFrames = 0;
  let mjpegStream = false;
  const parseChunks = (start, end, depth = 0, inMovi = false) => {
    if (depth > 4) throw new Error('AVI nesting too deep');
    for (let p = start; p + 8 <= end;) {
      const size = read(p + 4);
      const finish = p + 8 + size;
      if (finish > end) throw new Error('Truncated AVI chunk');
      const tag = ascii(b, p);
      if (tag === 'LIST' && size >= 4) {
        parseChunks(p + 12, finish, depth + 1, ascii(b, p + 8) === 'movi');
      } else if (tag === 'avih' && size >= 40) {
        const base = p + 8;
        width = read(base + 32); height = read(base + 36);
        declaredFrames = read(base + 16);
      } else if (tag === 'strh' && size >= 56) {
        const base = p + 8;
        if (ascii(b, base) === 'vids' && ascii(b, base + 4).toLowerCase() === 'mjpg') {
          mjpegStream = true;
          const scale = read(base + 20), rate = read(base + 24);
          fps = scale ? rate / scale : 0;
        }
      } else if (inMovi && tag === '00dc') {
        foundFrames++;
        if (size < 100 || b[p + 8] !== 0xff || b[p + 9] !== 0xd8) {
          throw new Error('AVI contains a non-JPEG video frame');
        }
      }
      p = finish + (size & 1);
    }
  };
  parseChunks(12, Math.min(b.length, read(4) + 8));
  if (width !== 240 || height !== 240 || ![0.5, 1, 2, 3].includes(fps) ||
      !mjpegStream || foundFrames < 1 ||
      foundFrames / fps > BG02_VIDEO.MAX_EXPERIMENTAL_SECONDS ||
      (declaredFrames && declaredFrames !== foundFrames)) {
    throw new Error('Expected 240x240 MJPEG AVI (0.5/1/2/3fps, up to 30s)');
  }
  return {
    width, height, fps,
    frames: foundFrames,
    seconds: foundFrames / fps,
    bytes: b.length,
    estimatedAllocationBytes: estimateVideoAllocation(b.length),
  };
}

/** Pull an MJPEG still from a known-compatible AVI for a source thumbnail. */
export function extractBg02AviFrame(input, frameIndex = 0) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  inspectBg02MjpegAvi(bytes);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error('Invalid AVI frame index');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (o) => view.getUint32(o, true);
  for (let p = 12; p + 12 <= bytes.length;) {
    const size = read(p + 4);
    const end = p + 8 + size;
    if (end > bytes.length) break;
    if (ascii(bytes, p) === 'LIST' && ascii(bytes, p + 8) === 'movi') {
      let n = 0;
      for (let q = p + 12; q + 8 <= end;) {
        const chunkSize = read(q + 4);
        if (q + 8 + chunkSize > end) break;
        if (ascii(bytes, q) === '00dc') {
          if (n === frameIndex) return bytes.slice(q + 8, q + 8 + chunkSize);
          n++;
        }
        q += 8 + chunkSize + (chunkSize & 1);
      }
    }
    p = end + (size & 1);
  }
  throw new Error('Requested AVI frame not found');
}

/** Rounded allocation is an empirical hint, not a proven erase-block map. */
export function estimateVideoAllocation(bytes) {
  // Upload adds a four-byte length prefix before the AVI bytes.
  return Math.ceil((bytes + 4) / BG02_VIDEO.ALLOCATION_HINT_BYTES) *
    BG02_VIDEO.ALLOCATION_HINT_BYTES;
}
