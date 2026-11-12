/**
 * Portable, local-only BG02 editing projects: ZIP with project.json and source.bin.
 * Projects contain the original image/video file, not device firmware/media.
 * Never contact a server, read Bluetooth, or upload automatically.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const PROJECT_VERSION = 1;
export const MAX_PROJECT_SOURCE = 64 * 1024 * 1024;
const MAX_METADATA = 128 * 1024;
const PROJECT_SIGNATURE = 'bg02-editor-project';

function nameOnly(name) {
  const result = String(name || 'source.bin').split(/[\\/]/).pop()
    .replace(/[\x00-\x1f]/g, '').slice(0, 180);
  return result || 'source.bin';
}

function validFinite(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
function validateCrop(c) {
  if (!c || typeof c !== 'object' ||
      !validFinite(c.zoom, .25, 4) ||
      !validFinite(c.offsetX, -100000, 100000) ||
      !validFinite(c.offsetY, -100000, 100000)) {
    throw new Error('Invalid project crop geometry');
  }
}

export function validateProjectState(kind, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('Invalid editor project state');
  if (kind === 'picture') {
    if (!['jpeg444','ru50'].includes(state.codec) ||
        !Number.isInteger(state.jpegQuality) ||
        state.jpegQuality < 35 || state.jpegQuality > 90)
      throw new Error('Invalid picture codec/quality in project');
    validateCrop(state.crop);
  } else if (kind === 'video') {
    if (!validFinite(state.start, 0, 3600) ||
        !validFinite(state.end, 0, 3600) ||
        state.end <= state.start ||
        ![.5,1,2,3].includes(state.fps) ||
        ![5,10,15,20,30].includes(state.seconds) ||
        !['low','medium','high'].includes(String(state.quality).toLowerCase()) ||
        !['cover','contain'].includes(state.fit) ||
        typeof state.loop !== 'boolean' ||
        typeof state.gifUseFrames !== 'boolean' ||
        ![1,2,3,6].includes(state.gifHold) ||
        !Array.isArray(state.frameIndices) ||
        state.frameIndices.length > 3000 ||
        !state.frameIndices.every(x=>Number.isInteger(x)&&x>=0&&x<=10000) ||
        !state.crop || typeof state.crop !== 'object') {
      throw new Error('Invalid video/GIF project options');
    }
    validateCrop(state.crop.sharedCrop);
    const overrides = state.crop.frameCropOverrides;
    if (!Array.isArray(overrides) || overrides.length > 3000)
      throw new Error('Invalid frame crop override list');
    for (const pair of overrides) {
      if (!Array.isArray(pair) || pair.length !== 2 ||
          !Number.isInteger(pair[0]) || pair[0] < 0 || pair[0] > 10000)
        throw new Error('Invalid frame crop index');
      validateCrop(pair[1]);
    }
  } else throw new Error('Unknown BG02 editor project kind');
  return state;
}

export async function createBg02Project(sourceFile, kind, state) {
  if (!sourceFile || typeof sourceFile.arrayBuffer !== 'function')
    throw new Error('Choose a source file to save a project');
  const bytes = new Uint8Array(await sourceFile.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PROJECT_SOURCE)
    throw new Error('Project source must be 1 byte to 64 MiB');
  validateProjectState(kind,state);
  const manifest = {
    signature: PROJECT_SIGNATURE, version: PROJECT_VERSION,
    kind, sourceName: nameOnly(sourceFile.name),
    sourceMime: String(sourceFile.type||'application/octet-stream').slice(0,100),
    sourceSize: bytes.length, state,
  };
  const meta = strToU8(JSON.stringify(manifest));
  if (meta.length > MAX_METADATA)
    throw new Error('Project settings exceed 128 KiB');
  return zipSync({
    'project.json': [meta,{level:0}],
    'source.bin': [bytes,{level:0}],
  },{level:0});
}

// Reject oversized decompressed entries by reading ZIP central directory sizes
// before decompressing any input. Only the two known project files are allowed.
function checkArchiveLimits(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 50 ||
      bytes.length > MAX_PROJECT_SOURCE + MAX_METADATA + 4096)
    throw new Error('Project ZIP exceeds size limit');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let count = 0;
  for (let i=0;i+46<=bytes.length;i++) {
    if (view.getUint32(i,true)!==0x02014b50)continue;
    const compressed=view.getUint32(i+20,true);
    const uncompressed=view.getUint32(i+24,true);
    const nameLen=view.getUint16(i+28,true);
    const extraLen=view.getUint16(i+30,true);
    const commentLen=view.getUint16(i+32,true);
    if (i+46+nameLen+extraLen+commentLen>bytes.length)
      throw new Error('Truncated project ZIP entry');
    const name=strFromU8(bytes.subarray(i+46,i+46+nameLen));
    const limit=name==='source.bin'?MAX_PROJECT_SOURCE:
      name==='project.json'?MAX_METADATA:0;
    if (!limit || !uncompressed || uncompressed>limit ||
        compressed>limit+128 || compressed===0)
      throw new Error('Unsafe or unexpected project ZIP entry');
    count++;
    i+=45+nameLen+extraLen+commentLen;
  }
  if(count!==2)throw new Error('Project ZIP must contain exactly two entries');
}

export function readBg02Project(archive) {
  const bytes=archive instanceof Uint8Array?archive:new Uint8Array(archive);
  checkArchiveLimits(bytes);
  const files=unzipSync(bytes);
  if (Object.keys(files).length!==2 || !files['project.json'] || !files['source.bin'])
    throw new Error('Unknown or incomplete BG02 project archive');
  const manifest=JSON.parse(strFromU8(files['project.json']));
  const source=files['source.bin'];
  if (manifest?.signature!==PROJECT_SIGNATURE ||
      manifest.version!==PROJECT_VERSION ||
      !['picture','video'].includes(manifest.kind) ||
      manifest.sourceSize!==source.length ||
      source.length===0 || source.length>MAX_PROJECT_SOURCE) {
    throw new Error('Invalid BG02 project manifest');
  }
  validateProjectState(manifest.kind,manifest.state);
  return {
    kind:manifest.kind,
    sourceName:nameOnly(manifest.sourceName),
    sourceMime:String(manifest.sourceMime||'application/octet-stream'),
    sourceBytes:source,
    state:manifest.state,
  };
}
