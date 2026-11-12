/**
 * Read-only BG02 media diagnostics.
 *
 * IMPORTANT: Baji module 0x03 list/delete is a DIFFERENT protocol.
 * There is not yet a proven BG02 list/delete transaction. This panel calls
 * ONLY two known read-only FitPro queries observed in actual Android HCI:
 *   0x20/2 dial information and 0x20/4 remaining media storage.
 * It exposes their values without claiming that a count byte = installed
 * files. No unknown opcodes, delete, format, or filesystem writes.
 */
import { formatBytes } from './image.js';
import { resolveBadgeProfile } from './device-profile.js';
import { probeBg02MediaTransport, mediaTelemetryDiff } from './bg02-media-capabilities.js';

export function bindBg02Library({ client, $, log }) {
  const el = {
    root: $('#bg02LibrarySection'),
    read: $('#btnBg02LibraryInspect'),
    export: $('#btnBg02LibraryExport'),
    probe: $('#btnBg02MediaInterface'),
    transport: $('#bg02MediaTransport'),
    transportDetails: $('#bg02MediaTransportDetails'),
    entries: $('#bg02MediaEntries'),
    telemetry: $('#bg02MediaTelemetry'),
    telemetrySummary: $('#bg02MediaTelemetrySummary'),
    free: $('#bg02LibraryFree'),
    count: $('#bg02LibraryCount'),
    algorithm: $('#bg02LibraryAlgorithm'),
    status: $('#bg02LibraryStatus'),
  };
  let reading = false;
  let probing = false;
  let lastDiagnostic = null;
  let transport = null;
  let telemetry = [];
  let telemetrySessionId = null;

  const allowed = (s = client.getSnapshot()) =>
    Boolean(s?.connected && s.storageProbeSupported &&
      s.protocolMode === 'fitpro' && resolveBadgeProfile(s).bg02);

  function update(snapshot = client.getSnapshot()) {
    const supported = allowed(snapshot);
    el.root.hidden = !supported;
    if (supported && telemetrySessionId !== snapshot.sessionId) {
      // A different badge's readings are not comparable to this session.
      telemetry = [];
      transport = null;
      lastDiagnostic = null;
      telemetrySessionId = snapshot.sessionId;
    }
    el.read.disabled = !supported || reading || probing || client.anyTransferring;
    el.probe.disabled = !supported || reading || probing || client.anyTransferring;
    el.export.disabled = !supported || !lastDiagnostic || reading || probing ||
      lastDiagnostic.sessionId !== snapshot.sessionId;
    el.transport.textContent = !supported ? 'Not connected' :
      transport?.ae00Visible === true
        ? transport.rcspService === 'ae00-rcsp-transport-candidate'
          ? 'AE00 transport candidate' : 'AE00 incomplete'
        : transport?.ae00Visible === false ? 'AE00 not accessible'
        : transport ? 'Unknown — see details' : 'Not checked';
    el.transportDetails.textContent = transport?.notes ||
      'The check only discovers the standard RCSP AE00 GATT service; it sends no media command.';
    el.entries.textContent = 'Not enumerated';
    el.telemetry.hidden = !supported || !telemetry.length;
    const latest = telemetry.at(-1);
    const diff = telemetry.length > 1
      ? mediaTelemetryDiff(telemetry[telemetry.length - 2], latest) : null;
    el.telemetrySummary.textContent = !latest
      ? 'Read media metadata twice to compare candidate count and free bytes.'
      : 'Read ' + telemetry.length + ' time(s). Latest: count field=' +
        latest.candidateCount + ', free=' + formatBytes(latest.freeBytes) +
        (diff
          ? ' · change since previous: count ' +
            (diff.countDelta >= 0 ? '+' : '') + diff.countDelta +
            ', free ' + (diff.freeBytesDelta >= 0 ? '+' : '') +
            formatBytes(Math.abs(diff.freeBytesDelta)) +
            (diff.freeBytesDelta < 0 ? ' used' : ' recovered')
          : ' · read again after changing media on the badge to compare') +
        '. Count-byte meaning remains unverified.';
    el.free.textContent = Number.isFinite(snapshot?.freeStorage)
      ? '~' + formatBytes(snapshot.freeStorage) : 'Not reported';
    el.count.textContent = Number.isInteger(snapshot?.dialPictureCountHint)
      ? snapshot.dialPictureCountHint + ' (unverified meaning)' : 'Not reported';
    el.algorithm.textContent = snapshot?.dialAlgorithm == null
      ? 'Not reported'
      : snapshot.dialAlgorithm === 4
        ? '4 (JPEG)' : String(snapshot.dialAlgorithm);
    if (!supported) {
      lastDiagnostic = null;
      transport = null;
      telemetry = [];
      telemetrySessionId = null;
      el.status.textContent =
        'Connect the verified BG02 V1.5. Listing and deletion are not implemented.';
    }
  }

  async function inspect() {
    const snap = client.getSnapshot();
    if (!allowed(snap)) return;
    if (reading || client.anyTransferring) return;
    reading = true;
    lastDiagnostic = null; // Never export stale values after a failed new read.
    el.status.textContent = 'Reading verified BG02 0x20/2 dial info and 0x20/4 storage…';
    update(snap);
    try {
      const dial = await client.refreshDialInfo({ timeoutMs: 5000 });
      if (client.getSnapshot().sessionId !== snap.sessionId)
        throw new Error('Badge switched while reading dial information');
      const storage = await client.refreshFitProStorage({ timeoutMs: 5000 });
      const now = client.getSnapshot();
      if (now.sessionId !== snap.sessionId || !allowed(now))
        throw new Error('Badge switched or disconnected during read');
      const readingRecord = {
        observedAt: new Date().toISOString(),
        candidateCount: dial.pictureNums,
        freeBytes: storage.reportedBytes,
      };
      telemetry.push(readingRecord);
      if (telemetry.length > 8) telemetry.shift();
      lastDiagnostic = {
        sessionId: snap.sessionId, // retained only in memory; not exported
        observedAt: new Date().toISOString(),
        identity: {
          name: now.name, model: now.model,
          hardware: now.hardware, firmware: now.firmware,
        },
        requests: ['FitPro 0x20/2', 'FitPro 0x20/4'],
        transport: transport || { rcspService: 'not-checked', fileListingConfirmed: false },
        mediaTelemetry: [...telemetry],
        dialInfo: {
          width: dial.width, height: dial.height,
          algorithm: dial.algorithm,
          pictureCountByte: dial.pictureNums,
          pictureCountMeaningVerified: false,
          themeVersionCandidate: dial.themeVersion,
        },
        storage: {
          rawWord0: storage.word0,
          remainingBytesCandidate: storage.reportedBytes,
          flashCapacityUnknown: true,
        },
        library: {
          entriesKnown: false,
          listOpcodeVerified: false,
          deleteOpcodeVerified: false,
        },
      };
      el.status.textContent =
        'Read succeeded. These are diagnostic fields, not a list of stored files; ' +
        'BG02 library listing and deletion remain unverified.';
      log({ msg: 'BG02 media diagnostics: known read-only 0x20/2 + 0x20/4 OK; ' +
        'count-byte=' + dial.pictureNums + ' free=' + storage.reportedBytes +
        ' B; no list/delete operation sent', level: 'ok' });
    } catch (e) {
      el.status.textContent = 'Read-only diagnostic failed: ' + e.message;
      log({ msg: 'BG02 media diagnostics: ' + e.message, level: 'warn' });
    } finally {
      reading = false;
      update();
    }
  }

  async function probeInterface() {
    const snap = client.getSnapshot();
    if (!allowed(snap) || reading || probing || client.anyTransferring) return;
    const server = client.getActiveGattServer();
    if (!server?.connected) {
      el.status.textContent = 'No active connected GATT server to inspect.';
      return;
    }
    probing = true;
    el.status.textContent = 'Inspecting GATT AE00 availability — no vendor commands or writes…';
    update(snap);
    try {
      const result = await probeBg02MediaTransport(server);
      if (client.getSnapshot().sessionId !== snap.sessionId || !allowed())
        throw new Error('Active badge switched or disconnected');
      transport = result;
      if (lastDiagnostic) lastDiagnostic.transport = result;
      el.status.textContent = result.notes;
      log({ msg: 'BG02 media GATT capability: ' + result.rcspService +
        ' · no RCSP/list/delete command transmitted', level: 'info' });
    } catch (e) {
      transport = null;
      el.status.textContent = 'GATT interface check unavailable: ' + e.message;
      log({ msg: 'BG02 media GATT check: ' + e.message, level: 'warn' });
    } finally {
      probing = false;
      update();
    }
  }

  function exportDiagnostic() {
    if (!lastDiagnostic || !allowed() ||
        lastDiagnostic.sessionId !== client.getSnapshot().sessionId) return;
    // Deliberately exclude BLE address, browser device ID, session ID, serial.
    const { sessionId: _ignored, ...safe } = lastDiagnostic;
    const blob = new Blob([JSON.stringify(safe, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BG02-library-readonly-diagnostic.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  el.read.addEventListener('click', () => void inspect());
  el.probe.addEventListener('click', () => void probeInterface());
  el.export.addEventListener('click', exportDiagnostic);
  update();
  return { update };
}
