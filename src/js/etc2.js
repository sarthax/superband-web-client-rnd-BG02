/**
 * Browser ETC2 RGB8 encoding using the ETC1 individual-mode subset.
 * ETC1 blocks are valid ETC2 RGB8 blocks (Khronos ETC specification).
 * No WASM, network calls, or native dependencies. Intended for 240x240 images.
 */
const MODIFIERS = [
  [2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29],
  [13, 42, -13, -42], [18, 60, -18, -60], [24, 80, -24, -80],
  [33, 106, -33, -106], [47, 183, -47, -183],
];
const clamp255 = (x) => Math.max(0, Math.min(255, x));
const clampNibble = (x) => Math.max(0, Math.min(15, x));

// Compress each 2x4 or 4x2 subblock against individual 4-bit RGB base
// colors and eight luminance modifier tables.
function chooseHalf(rgba, width, blockX, blockY, flip, second) {
  const coords = [];
  let rSum = 0, gSum = 0, bSum = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const inSecond = flip ? y >= 2 : x >= 2;
      if (inSecond !== second) continue;
      const at = ((blockY + y) * width + blockX + x) * 4;
      const r = rgba[at], g = rgba[at + 1], b = rgba[at + 2];
      coords.push({ x, y, r, g, b });
      rSum += r; gSum += g; bSum += b;
    }
  }
  const quant = [rSum / 8, gSum / 8, bSum / 8]
    .map(v => clampNibble(Math.round(v / 17)));
  let best = null;
  const offsets = [
    [0,0,0],[-1,-1,-1],[1,1,1],
    [-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],
  ];
  for (const offset of offsets) {
    const components = quant.map((v,i) => clampNibble(v + offset[i]));
    const [r0,g0,b0] = components.map(v => v*17);
    for (let table=0; table<8; table++) {
      const modifiers = MODIFIERS[table];
      let error = 0, low = 0;
      for (const {x,y,r,g,b} of coords) {
        let min = Infinity, selector = 0;
        for (let j=0; j<4; j++) {
          const m = modifiers[j];
          const dr = r - clamp255(r0 + m);
          const dg = g - clamp255(g0 + m);
          const db = b - clamp255(b0 + m);
          const e = dr*dr+dg*dg+db*db;
          if (e < min) { min=e; selector=j; }
        }
        error += min;
        // ETC bit indices: column-major within each 4x4 block.
        const k = x*4+y;
        if (selector & 1) low |= (1 << k);
        if (selector & 2) low |= (1 << (k+16));
      }
      if (!best || error < best.error) {
        best = {components, table, low:low>>>0, error};
      }
    }
  }
  return best;
}

/** Compress a 4x4 RGBA block to a standards-valid ETC2 RGB8 block. */
export function encodeEtc2Block(rgba,width,blockX,blockY) {
  let winner = null;
  for (const flip of [0,1]) {
    const a = chooseHalf(rgba,width,blockX,blockY,flip,false);
    const b = chooseHalf(rgba,width,blockX,blockY,flip,true);
    const score = a.error+b.error;
    if (!winner || score<winner.score) winner={a,b,flip,score};
  }
  const {a,b,flip} = winner;
  const high = (
    (a.components[0] << 28) | (b.components[0] << 24) |
    (a.components[1] << 20) | (b.components[1] << 16) |
    (a.components[2] << 12) | (b.components[2] << 8) |
    (a.table << 5) | (b.table << 2) | flip // diffbit = 0 (individual mode)
  ) >>> 0;
  const low = (a.low | b.low) >>> 0;
  const result = new Uint8Array(8);
  const view = new DataView(result.buffer);
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return result;
}

/**
 * Compress RGBA image pixels to ETC2 RGB8, row-major 4x4 blocks.
 * Yields periodically to keep the web editor responsive while encoding.
 */
export async function encodeEtc2Rgb(imageData) {
  const {width,height,data} = imageData || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width<=0 || height<=0 || width%4 || height%4) {
    throw new Error('ETC2 requires dimensions divisible by four');
  }
  if (!data || data.length !== width*height*4) {
    throw new Error('Invalid RGBA image data');
  }
  const bytes = new Uint8Array(width*height/2);
  let offset=0;
  for (let y=0; y<height; y+=4) {
    for (let x=0; x<width; x+=4) {
      bytes.set(encodeEtc2Block(data,width,x,y),offset);
      offset+=8;
    }
    if (y && y%32 === 0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return bytes;
}

/**
 * Decode our own ETC1 individual-mode subset of ETC2 RGB8 into RGBA for
 * comparison previews. This intentionally rejects ETC2 modes our browser
 * encoder never emits; it is NOT a general-purpose vendor RU50 decoder.
 * The result is pixels decoded from the actual compressed ETC2 bytes.
 */
export function decodeEtc2IndividualRgb(bytes, width = 240, height = 240) {
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(width) ||
      !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width % 4 || height % 4 || bytes.length !== width * height / 2) {
    throw new Error('Invalid ETC2 RGB8 data for comparison');
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let by = 0, offset = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4, offset += 8) {
      const hi = view.getUint32(offset, false);
      const lo = view.getUint32(offset + 4, false);
      if (hi & 2) {
        throw new Error('RU50 preview supports only browser-generated ETC1 individual mode');
      }
      const flip = hi & 1;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const second = flip ? y >= 2 : x >= 2;
          const base = second
            ? [(hi >>> 24) & 15, (hi >>> 16) & 15, (hi >>> 8) & 15]
            : [(hi >>> 28) & 15, (hi >>> 20) & 15, (hi >>> 12) & 15];
          const table = second ? (hi >>> 2) & 7 : (hi >>> 5) & 7;
          const k = x * 4 + y;
          const selector = ((lo >>> k) & 1) | (((lo >>> (k + 16)) & 1) << 1);
          const modifier = MODIFIERS[table][selector];
          const at = ((by + y) * width + bx + x) * 4;
          rgba[at] = clamp255(base[0] * 17 + modifier);
          rgba[at + 1] = clamp255(base[1] * 17 + modifier);
          rgba[at + 2] = clamp255(base[2] * 17 + modifier);
          rgba[at + 3] = 255;
        }
      }
    }
  }
  return { width, height, data: rgba };
}
