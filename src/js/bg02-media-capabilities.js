/**
 * Read-only reconnaissance for possible BG02 media-list transports.
 *
 * The verified BG02 path is FitPro/Dial31 on UART (7E40). JieLi's generic
 * file/wallpaper browser requires an RCSP-capable service (normally AE00)
 * AND firmware support for file browsing. Seeing AE00 is not proof that
 * the read-only file-list command exists or that RCSP authentication passes.
 *
 * Calls only Web Bluetooth's GATT service/characteristic discovery.
 * No characteristic reads, notification subscriptions, writes, pairing,
 * RCSP request frames, delete commands or unverified FitPro opcodes.
 */
import { JIELI_OTA } from './jieli-ota.js';

const knownProps = [
  'read', 'write', 'writeWithoutResponse', 'notify', 'indicate',
  'authenticatedSignedWrites', 'reliableWrite', 'writableAuxiliaries',
];

function summarizeCharacteristic(char) {
  const props = char.properties || {};
  return {
    uuid: String(char.uuid || '').toLowerCase(),
    properties: knownProps.filter(p => props[p] === true),
  };
}

export async function probeBg02MediaTransport(server) {
  if (!server?.connected || typeof server.getPrimaryService !== 'function') {
    throw new Error('BG02 must be connected for GATT capability inspection');
  }
  let service;
  try {
    service = await server.getPrimaryService(JIELI_OTA.SERVICE);
  } catch (e) {
    // The browser's Web Bluetooth permission differs from device support.
    // A missing service is evidence only for this GATT connection/profile.
    if (e?.name === 'NotFoundError') {
      return {
        rcspService: 'not-advertised-or-accessible',
        ae00Visible: false, ae01Visible: false, ae02Visible: false,
        characteristics: [], fileListingConfirmed: false,
        notes: 'RCSP AE00 was not available in this connected GATT profile. ' +
          'This does not prove the firmware lacks a separate file-list protocol.',
      };
    }
    return {
      rcspService: 'unknown',
      ae00Visible: null, ae01Visible: null, ae02Visible: null,
      characteristics: [], fileListingConfirmed: false,
      notes: 'GATT AE00 discovery could not complete (' +
        (e?.name || 'error') +
        '). Browser permission/transport failure is not evidence of absence.',
    };
  }
  let characteristics;
  try {
    characteristics = (await service.getCharacteristics()).map(summarizeCharacteristic);
  } catch (e) {
    return {
      rcspService: 'present-characteristics-unreadable',
      ae00Visible: true, ae01Visible: null, ae02Visible: null,
      characteristics: [], fileListingConfirmed: false,
      notes: 'AE00 exists, but browser could not enumerate its characteristics (' +
        (e?.name || 'error') + ').',
    };
  }
  const ae01 = characteristics.find(c => c.uuid === JIELI_OTA.WRITE);
  const ae02 = characteristics.find(c => c.uuid === JIELI_OTA.NOTIFY);
  const supportsWrite = Boolean(ae01?.properties.some(p =>
    p === 'write' || p === 'writeWithoutResponse'));
  const supportsNotify = Boolean(ae02?.properties.some(p =>
    p === 'notify' || p === 'indicate'));
  const potentialRcsp = supportsWrite && supportsNotify;
  return {
    rcspService: potentialRcsp ? 'ae00-rcsp-transport-candidate' :
      'ae00-incomplete-transport',
    ae00Visible: true,
    ae01Visible: Boolean(ae01),
    ae02Visible: Boolean(ae02),
    characteristics,
    fileListingConfirmed: false,
    notes: potentialRcsp
      ? 'AE00/AE01/AE02 look capable of RCSP transport, but auth, the ' +
        'file-browser opcode and firmware support are NOT established. ' +
        'No command was sent.'
      : 'AE00 is visible, but normal AE01 write + AE02 notify transport ' +
        'was not confirmed. No command was sent.',
  };
}

/**
 * Summarize only user-initiated read-only dial-info/storage measurements.
 * A change in the pictureNums field is not by itself proof of enumeration.
 */
export function mediaTelemetryDiff(prior, next) {
  if (!prior || !next) return null;
  const values = [prior.candidateCount, next.candidateCount,
    prior.freeBytes, next.freeBytes];
  if (!values.every(Number.isSafeInteger)) return null;
  return {
    countDelta: next.candidateCount - prior.candidateCount,
    freeBytesDelta: next.freeBytes - prior.freeBytes,
    // Never label the candidate count as files or infer capacity.
    candidateCountMeaningVerified: false,
  };
}
