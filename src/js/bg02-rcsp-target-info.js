/**
 * BG02 RCSP identity-only probe.
 *
 * The existing jieli-ota.js packet helper is NOT used: its envelope does not
 * match JieLi's documented FE DC BA | flags | opcode | BE16 length | data | EF
 * format. This module sends exactly ONE documented read-only GET_TARGET_INFO
 * (0x03) command on AE01, and listens for a matching AE02 response.
 *
 * Explicitly does NOT authenticate, enumerate storage, enter OTA, send file
 * commands, or retry with guessed opcodes. Nothing runs automatically.
 */
import { JIELI_OTA } from './jieli-ota.js';

const MAGIC = [0xfe, 0xdc, 0xba];
const TAIL = 0xef;
const MAX_RCSP_PAYLOAD = 1024;
const OPCODE_TARGET_INFO = 0x03;

export function buildRcspTargetInfoRequest(sequence = 0) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) {
    throw new Error('RCSP sequence number must be a byte');
  }
  // Captured vendor-target-info mask: FF FF FF FF, followed by 00.
  const body = Uint8Array.of(sequence, 0xff, 0xff, 0xff, 0xff, 0x00);
  return Uint8Array.of(
    ...MAGIC, 0xc0, OPCODE_TARGET_INFO, 0, body.length, ...body, TAIL,
  );
}

/**
 * Stateful RCSP-fragment assembler: notifications can be split or coalesced.
 * Returns complete, strictly delimited frames. Does not decode proprietary
 * target-info payload fields (which may vary across firmware generations).
 */
export class Bg02RcspAssembler {
  constructor() {
    this.buffer = new Uint8Array(0);
  }

  push(chunk) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (bytes.length > 4096) throw new Error('Unexpectedly long RCSP notify');
    const all = new Uint8Array(this.buffer.length + bytes.length);
    all.set(this.buffer);
    all.set(bytes, this.buffer.length);
    let offset = 0;
    const frames = [];
    while (offset + 3 <= all.length) {
      if (all[offset] !== MAGIC[0] || all[offset+1] !== MAGIC[1] ||
          all[offset+2] !== MAGIC[2]) {
        offset++;
        continue;
      }
      if (all.length - offset < 7) break;
      const length = all[offset+5] * 256 + all[offset+6];
      if (length > MAX_RCSP_PAYLOAD) {
        // Bad header — advance to the next possible sync word.
        offset++;
        continue;
      }
      const total = 8 + length;
      if (all.length - offset < total) break;
      if (all[offset+total-1] !== TAIL) {
        offset++;
        continue;
      }
      const body = all.slice(offset+7, offset+7+length);
      frames.push({ flags: all[offset+3], opcode: all[offset+4],
        body, length });
      offset += total;
    }
    this.buffer = all.slice(offset);
    if (this.buffer.length > MAX_RCSP_PAYLOAD + 7) {
      throw new Error('RCSP receive buffer exceeded safe size');
    }
    return frames;
  }
}

export function parseMatchingTargetInfo(frame, sequence) {
  if (!frame || frame.opcode !== OPCODE_TARGET_INFO ||
      (frame.flags & 0x80) !== 0 || frame.body?.length < 2 ||
      frame.body[1] !== sequence) return null;
  return {
    responseReceived: true,
    opcode: OPCODE_TARGET_INFO,
    status: frame.body[0],
    sequence: frame.body[1],
    payloadLength: frame.body.length - 2,
    // The raw target-info bytes may contain identifiers; intentionally
    // avoid exporting them until an explicit, redacted decoder is qualified.
    rawPayloadRetained: false,
    authConfirmed: false,
    fileListingConfirmed: false,
  };
}

export async function probeBg02RcspTargetInfo(server, {
  timeoutMs = 5000,
  checkCurrent = () => true,
} = {}) {
  if (!server?.connected || !checkCurrent()) {
    throw new Error('Badge is not connected or active session changed');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10000) {
    throw new Error('RCSP identity probe timeout must be 1–10 seconds');
  }
  const service = await server.getPrimaryService(JIELI_OTA.SERVICE);
  const write = await service.getCharacteristic(JIELI_OTA.WRITE);
  const notify = await service.getCharacteristic(JIELI_OTA.NOTIFY);
  if (!write.properties?.writeWithoutResponse ||
      !notify.properties?.notify) {
    throw new Error('AE01 writeWithoutResponse and AE02 notify are required');
  }
  if (!server.connected || !checkCurrent()) {
    throw new Error('Badge disconnected before RCSP request');
  }

  const seq = 0;
  const assembler = new Bg02RcspAssembler();
  let settle = null, timeoutId = null;
  let attached = false, subscribed = false;
  const receive = new Promise(resolve => { settle = resolve; });
  const onNotify = event => {
    try {
      const value = event?.target?.value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      for (const frame of assembler.push(bytes)) {
        const result = parseMatchingTargetInfo(frame, seq);
        if (result) { settle(result); return; }
      }
    } catch (error) {
      settle({ error });
    }
  };
  try {
    await notify.startNotifications();
    subscribed = true;
    notify.addEventListener('characteristicvaluechanged', onNotify);
    attached = true;
    if (!server.connected || !checkCurrent()) {
      throw new Error('Badge changed while starting RCSP notifications');
    }
    // Exactly one documented read-only command; no retries or OTA entry.
    await write.writeValueWithoutResponse(buildRcspTargetInfoRequest(seq));
    const result = await Promise.race([
      receive,
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
    if (!server.connected || !checkCurrent()) {
      throw new Error('Badge disconnected or changed during RCSP identity read');
    }
    if (result.error) throw result.error;
    if (result.timedOut) {
      return {
        responseReceived: false,
        timedOut: true,
        authConfirmed: false,
        fileListingConfirmed: false,
        notes: 'No matched GET_TARGET_INFO response. Authentication may be ' +
          'required, or this command may be unsupported. No further command sent.',
      };
    }
    return {
      ...result,
      notes: result.status === 0
        ? 'RCSP GET_TARGET_INFO replied with status 0; transport is responsive. ' +
          'File browsing and authentication remain unverified.'
        : 'RCSP GET_TARGET_INFO replied with status ' + result.status +
          '; this may be an error or authentication requirement. ' +
          'File browsing remains unverified.',
    };
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
    if (attached) notify.removeEventListener('characteristicvaluechanged', onNotify);
    if (subscribed) {
      try { await notify.stopNotifications(); } catch { /* disconnected */ }
    }
  }
}
