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

export function bindBg02Library({ client, $, log }) {
  const el = {
    root: $('#bg02LibrarySection'),
    read: $('#btnBg02LibraryInspect'),
    export: $('#btnBg02LibraryExport'),
    free: $('#bg02LibraryFree'),
    count: $('#bg02LibraryCount'),
    algorithm: $('#bg02LibraryAlgorithm'),
    status: $('#bg02LibraryStatus'),
  };
  let reading = false;
  let lastDiagnostic = null;

  const allowed = (s = client.getSnapshot()) =>
    Boolean(s?.connected && s.storageProbeSupported &&
      s.protocolMode === 'fitpro' && resolveBadgeProfile(s).bg02);

  function update(snapshot = client.getSnapshot()) {
    const supported = allowed(snapshot);
    el.root.hidden = !supported;
    el.read.disabled = !supported || reading || client.anyTransferring;
    el.export.disabled = !supported || !lastDiagnostic || reading ||
      lastDiagnostic.sessionId !== snapshot.sessionId;
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
      lastDiagnostic = {
        sessionId: snap.sessionId, // retained only in memory; not exported
        observedAt: new Date().toISOString(),
        identity: {
          name: now.name, model: now.model,
          hardware: now.hardware, firmware: now.firmware,
        },
        requests: ['FitPro 0x20/2', 'FitPro 0x20/4'],
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
  el.export.addEventListener('click', exportDiagnostic);
  update();
  return { update };
}
