import { SuperBandClient, FileType, FunctionType } from './client.js';
import { prepareFileForBadge, loadImage, formatBytes, DEFAULT_DIAL } from './image.js';
import { inspectRu50, encodeImageDataRu50, looksLikeBg02 } from './ru50.js';
import { CircleCropEditor } from './circle-crop.js';
import { REPO_URL } from './protocol.js';
import { resolveBadgeProfile, imageMatchesBadge } from './device-profile.js';
import { bindAdvanced } from './advanced.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const client = new SuperBandClient();
let prepared = null;
let transferring = false;
let activeProfileKey = null;
let previewGeneration = 0;
const cropper = new CircleCropEditor({
  canvas: $('#cropCanvas'),
  zoomInput: $('#cropZoom'),
  resetButton: $('#cropReset'),
  onChange: ({zoom}) => { $('#cropZoomValue').textContent = zoom + '%'; },
});
function showCropper() {
  $('#dialPreview').hidden = true;
  $('#dialPlaceholder').hidden = true;
  $('#cropCanvas').hidden = false;
  $('#cropControls').hidden = false;
  $('#dial').classList.add('crop-active','round');
}
function hideCropper() {
  $('#cropCanvas').hidden = true;
  $('#cropControls').hidden = true;
  $('#dial').classList.remove('crop-active');
}


function setPill(el, text, state = '') {
  el.textContent = text;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

function syncConnectionChrome() {
  const n = client.sessionCount;
  const on = n > 0 && client.connected;
  $('[data-need-conn]').forEach((b) => {
    b.disabled = !on;
  });
  // The upstream OTA firmware presets target BJ-1/DG01, not BG02 V1.5.
  // Keep the BG02 flash actions disabled even after session refreshes.
  if (resolveBadgeProfile(client.getSnapshot()).bg02) {
    $('#btnOtaFlash').disabled = true;
  }

  // Always allow adding another device while Web Bluetooth works
  $('#btnConnect').hidden = false;
  $('#btnConnectAny').hidden = false;
  $('#btnConnect').textContent = n ? 'Add badge' : 'Connect badge';
  $('#btnConnectAny').textContent = n ? 'Add other' : 'Other device';
  $('#btnAddBadge').hidden = n === 0;
  $('#btnDisconnect').hidden = n === 0;
  $('#btnDisconnectAll').hidden = n < 2;
  $('#btnPushAll').hidden = n < 2;

  const label =
    n === 0
      ? 'Disconnected'
      : n === 1
        ? `Connected · ${client.name || 'badge'}`
        : `${n} badges · active ${client.name || '—'}`;
  setPill($('#connPill'), label, n ? 'ok' : '');
  $('#deviceGlance').hidden = !on;
  $('#deviceRail').hidden = n === 0;
  $('#deviceCount').textContent = String(n);
  updatePushChecklist();
}

function renderDeviceChips() {
  const box = $('#deviceChips');
  box.innerHTML = '';
  for (const s of client.sessions) {
    const chip = document.createElement('div');
    chip.className = 'device-chip' + (s.active ? ' active' : '');
    chip.dataset.id = s.id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'device-chip-main';
    main.title = 'Make active';
    const title = s.name || 'Badge';
    const sub = [s.firmware, s.battery != null ? `${s.battery}%` : null].filter(Boolean).join(' · ');
    main.innerHTML = `<span class="chip-name"></span><span class="chip-sub"></span>`;
    main.querySelector('.chip-name').textContent = title + (s.active ? ' · active' : '');
    main.querySelector('.chip-sub').textContent = sub || s.id.slice(0, 8);
    main.addEventListener('click', () => {
      try {
        client.setActive(s.id);
        toast(`Active: ${client.name || s.id}`, 'ok');
        if (client.getSnapshot().protocolMode === 'baji') {
          client.requestMediaList().catch((e) => {
            log({ msg: `Media list: ${e.message}`, level: 'warn' });
          });
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'device-chip-x';
    x.title = 'Disconnect this badge';
    x.textContent = '×';
    x.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await client.disconnect(s.id);
        toast('Badge disconnected', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    chip.appendChild(main);
    chip.appendChild(x);
    box.appendChild(chip);
  }
}

function log({ msg, level = 'info' }) {
  const box = $('#activityLog');
  const row = document.createElement('div');
  row.className = `log-line ${level}`;
  row.innerHTML = `<span class="t"></span><span class="m"></span>`;
  row.querySelector('.t').textContent = new Date().toLocaleTimeString();
  row.querySelector('.m').textContent = msg;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.hidden = true;
    }, 280);
  }, 2800);
}

function fmtBig(n) {
  if (n == null) return '—';
  const v = typeof n === 'bigint' ? Number(n) : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return formatBytes(v);
}

function dash(v) {
  return v == null || v === '' ? '—' : String(v);
}

/**
 * Update device-dependent defaults only when identity or reported display
 * geometry changes; preserve manual size changes for other badge families.
 * Never mark a previously prepared image compatible with a different badge.
 */
function applyBadgeProfile(snapshot = client.getSnapshot()) {
  const profile = resolveBadgeProfile(snapshot);
  const key = [
    snapshot?.sessionId || '-', profile.id, profile.width, profile.height,
    profile.format,
  ].join('|');
  const changed = key !== activeProfileKey;
  if (changed) {
    activeProfileKey = key;
    previewGeneration++;
    prepared = null;
    cropper.clear();
    hideCropper();
    $('#dialW').value = String(profile.width);
    $('#dialH').value = String(profile.height);
  }

  $('#dialW').disabled = profile.fixedSize;
  $('#dialH').disabled = profile.fixedSize;
  $('#dialWidthOption').title = profile.fixedSize ? 'Fixed for the BG02 display' : '';
  $('#dialHeightOption').title = profile.fixedSize ? 'Fixed for the BG02 display' : '';
  $('#imageInput').accept = profile.fileAccept;
  $('#btnPickImage').textContent = profile.chooseLabel;
  $('#imageFormatHelp').textContent = profile.formatLabel;
  $('#imageInputHint').textContent = profile.formatHelp;
  $('#mediaLibrarySection').hidden = !profile.showMediaLibrary;
  $('#roleOptions').hidden = !profile.showBajiOptions;
  $('#allocMediaOption').hidden = !profile.showBajiOptions;
  $('#roundMaskOption').hidden = profile.bg02;
  $('#btnPushAll').hidden = profile.bg02 || client.sessionCount < 2;
  $('#btnPush').textContent = profile.bg02 ? 'Upload picture' : 'Upload to badge';
  $('#otaPreset').disabled = profile.bg02;
  $('#btnOtaPrepare').disabled = profile.bg02;
  $('#otaCatVersion').disabled = profile.bg02;
  $('#otaCatName').disabled = profile.bg02;
  $('#btnOtaProbeCatalog').disabled = profile.bg02;

  // The presets in Advanced are for BJ-1/DG01, not our LJ733 V1.5.
  // Do not accidentally offer unrelated firmware flashing as a BG02 action.
  $('#btnOtaFlash').disabled = profile.bg02 || !client.connected;
  $('#btnOtaFlashPicker').disabled = profile.bg02;
  $('#otaConfirmRisk').disabled = profile.bg02;
  if (changed && profile.bg02) $('#otaConfirmRisk').checked = false;
  if (changed) {
    const file = $('#imageInput').files?.[0];
    if (file) {
      void rebuildPreview();
    } else {
      $('#dialPreview').hidden = true;
      $('#dialPlaceholder').hidden = false;
      $('#dialPlaceholder').textContent = 'Choose an image to preview';
      $('#imageMeta').textContent = 'No image selected.';
    }
  }
  updatePushChecklist();
}

function renderSnapshot(snap) {
  const s = snap || client.getSnapshot();
  applyBadgeProfile(s);
  const battery = s.battery == null ? '—' : `${s.battery}%`;

  const fields = {
    name: dash(s.name),
    model: dash(s.model),
    firmware: dash(s.firmware),
    hardware: dash(s.hardware),
    software: dash(s.software),
    manufacturer: dash(s.manufacturer),
    battery,
    protocol: dash(s.protocol),
    free: fmtBig(s.freeStorage),
    cap: fmtBig(s.storageCapacity),
  };

  for (const [key, val] of Object.entries(fields)) {
    $$('[data-field="' + key + '"]').forEach((el) => {
      el.textContent = val;
    });
  }

  const glance = {
    name: fields.name,
    model: fields.model,
    firmware: fields.firmware,
    battery: fields.battery,
    hardware: fields.hardware,
    free: fields.free,
  };
  for (const [key, val] of Object.entries(glance)) {
    const el = document.querySelector(`[data-glance="${key}"]`);
    if (el) el.textContent = val;
  }

  if (s.protocolMode === 'fitpro') {
    $('#mediaIdPill').textContent = 'FitPro dial31';
  } else if (s.mediaId != null) {
    $('#mediaIdPill').textContent = `Media ID ${s.mediaId}`;
  } else if (!s.connected) {
    $('#mediaIdPill').textContent = 'Media ID —';
  }
}

function updatePushChecklist() {
  const connected = client.connected;
  const imageReady = !!prepared;
  const idle = !transferring && !client.anyTransferring;
  const map = { conn: connected, image: imageReady, idle };
  for (const [key, ok] of Object.entries(map)) {
    const li = document.querySelector(`[data-check="${key}"]`);
    if (!li) continue;
    li.dataset.ok = ok ? '1' : '0';
  }
  const profile = resolveBadgeProfile(client.getSnapshot());
  const compatible = imageMatchesBadge(prepared, profile, client.getSnapshot());
  const canPush = connected && imageReady && compatible && idle;
  $('#btnPush').disabled = !canPush;
  $('#btnPushAll').disabled = !(
    client.sessionCount >= 2 && canPush && !profile.bg02 &&
    prepared?.format !== 'ru50'
  );
}

function renderMediaList(items) {
  const box = $('#mediaList');
  if (!items?.length) {
    box.innerHTML =
      '<div class="empty">No media entries parsed (device may use a different list layout). Push still works.</div>';
    return;
  }
  box.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'media-item';
    row.innerHTML = `
      <div class="meta">
        <div class="title"></div>
        <div class="sub"></div>
      </div>
      <button class="danger" type="button">Delete</button>`;
    row.querySelector('.title').textContent = item.name || `Media ${item.mediaId}`;
    row.querySelector('.sub').textContent =
      `id=${item.mediaId} · ${formatBytes(item.fileSize)} · type=${item.fileType}`;
    row.querySelector('button').addEventListener('click', async () => {
      try {
        await client.deleteMedia(item.mediaId);
        toast(`Delete sent for ${item.mediaId}`, 'ok');
        await client.requestMediaList().catch(() => {});
      } catch (e) {
        toast(e.message, 'err');
        log({ msg: e.message, level: 'err' });
      }
    });
    box.appendChild(row);
  }
}

async function connect(acceptAll) {
  try {
    setPill($('#connPill'), 'Connecting…', 'busy');
    await client.connect({ acceptAll });
    syncConnectionChrome();
    renderDeviceChips();
    renderSnapshot();
    toast(
      client.sessionCount > 1
        ? `Added · ${client.sessionCount} badges connected`
        : 'Badge connected',
      'ok',
    );
    const snap = client.getSnapshot();
    if (snap.protocolMode === 'baji') {
      client.requestMediaList().catch((e) => {
        log({ msg: `Media list: ${e.message}`, level: 'warn' });
      });
    } else if (snap.protocolMode === 'fitpro') {
      log({ msg: 'FitPro badge — media library skipped (use Push for dial31 upload)', level: 'info' });
    }
    // applyBadgeProfile() already rebuilds the selected image on identity change.
  } catch (e) {
    syncConnectionChrome();
    renderDeviceChips();
    if (!client.sessionCount) {
      setPill($('#connPill'), 'Connect failed', 'err');
    }
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  }
}

async function rebuildPreview() {
  const token = ++previewGeneration;
  const file = $('#imageInput').files?.[0];
  prepared = null;
  updatePushChecklist();
  hideCropper();
  if (!file) {
    cropper.clear();
    $('#dialPreview').hidden = true;
    $('#dialPlaceholder').hidden = false;
    $('#dialPlaceholder').textContent = 'Choose a picture';
    $('#imageMeta').textContent = 'No image selected.';
    return;
  }

  const snap = client.getSnapshot();
  const profile = resolveBadgeProfile(snap);
  const isRu50 = file.name.toLowerCase().endsWith('.ru50');
  const isPicture = file.type.startsWith('image/') ||
    /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(file.name);

  try {
    if (isRu50 && !profile.bg02) {
      throw new Error('RU50 is only supported for BG02/LJ733 badges');
    }
    if (!isRu50 && !isPicture) {
      throw new Error('Choose a JPG, PNG, WebP or RU50 image');
    }
    let next;
    if (isRu50) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = inspectRu50(bytes);
      next = {
        blob:file, bytes, width:info.width, height:info.height,
        format:'ru50', source:'encoded',
      };
    } else if (profile.bg02) {
      const image = await loadImage(file);
      next = {
        bytes:null, width:240, height:240,
        format:'ru50', source:'crop', name:file.name,
      };
      // Do not create a crop for an obsolete badge or image selection.
      if(token === previewGeneration &&
         snap.sessionId === client.getSnapshot().sessionId) {
        cropper.setImage(image);
        showCropper();
      }
    } else {
      next = await prepareFileForBadge(file, {
        width:Number($('#dialW').value)||profile.width,
        height:Number($('#dialH').value)||profile.height,
        quality:0.5,
        round:$('#roundMask').checked,
        format:profile.format,
      });
    }

    const now = client.getSnapshot();
    if(token !== previewGeneration || snap.sessionId !== now.sessionId ||
       resolveBadgeProfile(now).format !== next.format) return;

    prepared = next;
    if (isRu50) {
      $('#dialPreview').hidden = true;
      $('#dialPlaceholder').hidden = false;
      $('#dialPlaceholder').textContent = 'Encoded RU50 image ready';
      $('#imageMeta').textContent =
        `${file.name} → 240×240 RU50/ETC2 · ${formatBytes(next.bytes.length)}`;
    } else if (profile.bg02) {
      $('#imageMeta').textContent =
        `${file.name} → round 240×240 crop · converted automatically when uploaded`;
    } else {
      $('#dialPreview').src = next.previewUrl;
      $('#dialPreview').hidden = false;
      $('#dialPlaceholder').hidden = true;
      $('#dial').classList.toggle('round',$('#roundMask').checked);
      const fmtLabel = next.format === 'jpeg444' ? 'JPEG 4:4:4' : 'RGB565';
      $('#imageMeta').textContent =
        `${file.name} → ${next.width}×${next.height} ${fmtLabel} · ${formatBytes(next.bytes.length)}`;
    }
  } catch(e) {
    if(token !== previewGeneration)return;
    cropper.clear();
    hideCropper();
    prepared=null;
    $('#imageMeta').textContent = `Unable to prepare picture: ${e.message}`;
    toast(e.message,'err');
    log({msg:e.message,level:'err'});
  } finally {
    updatePushChecklist();
  }
}

async function pushImage() {
  if (!client.connected) {
    toast('Connect a badge first', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  if (prepared.format === 'ru50') {
    const snap = client.getSnapshot();
    if (snap.protocolMode !== 'fitpro' || !looksLikeBg02(snap)) {
      toast('RU50 experiment requires a confirmed BG02/LJ733 FitPro badge', 'err');
      return;
    }
    log({ msg: 'BG02 RU50/ETC2 image transfer', level: 'info' });
  }
  const activeSnapshot = client.getSnapshot();
  if (!imageMatchesBadge(prepared, resolveBadgeProfile(activeSnapshot), activeSnapshot)) {
    toast('Image format does not match this badge. Select a compatible image.', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  transferring = true;
  updatePushChecklist();
  try {
    let uploadBytes = prepared.bytes;
    if (prepared.source === 'crop') {
      log({ msg: 'Cropping and converting the picture for BG02…', level:'info' });
      uploadBytes = await encodeImageDataRu50(cropper.getImageData(240));
      const snapshot = client.getSnapshot();
      if (!client.connected || snapshot.sessionId !== activeSnapshot.sessionId ||
          !resolveBadgeProfile(snapshot).bg02) {
        throw new Error('Badge changed during image conversion; reconnect and try again');
      }
      inspectRu50(uploadBytes);
      log({ msg: `Image encoded: ${formatBytes(uploadBytes.length)} RU50/ETC2`, level:'ok' });
    }
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const result = await client.transferFile(uploadBytes, {
      fileType: FileType.IMAGE,
      functionType,
      allocateId: $('#allocMedia').checked,
      onProgress: (pct) => {
        bar.style.width = `${pct}%`;
      },
    });
    const via = result.path === 'fitpro-dial31' ? 'dial31' : 'baji';
    toast(
      result.verified === false
        ? 'Uploaded (verify unclear)'
        : `Pushed to ${client.name || 'badge'} (${via})`,
      'ok',
    );
    log({
      msg: `Push complete → ${client.name || result.sessionId} via=${via} id=${result.mediaId} sum=0x${Number(result.checksum).toString(16)}`,
      level: 'ok',
    });
    if (via === 'baji') {
      $('#mediaIdPill').textContent = `Media ID ${result.mediaId}`;
      client.requestMediaList().catch(() => {});
    } else {
      $('#mediaIdPill').textContent = 'FitPro dial31';
    }
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

async function pushAll() {
  if (client.sessionCount < 2) {
    toast('Connect at least two badges', 'err');
    return;
  }
  if (!prepared) {
    toast('Choose an image first', 'err');
    return;
  }
  if (prepared.format === 'ru50') {
    toast('Experimental RU50 is limited to one verified BG02 at a time', 'err');
    return;
  }
  const bar = $('#pushBar');
  const wrap = $('#pushProgress');
  wrap.hidden = false;
  bar.style.width = '0%';
  transferring = true;
  updatePushChecklist();
  log({
    msg: `Simultaneous push to ${client.sessionCount} badges…`,
    level: 'info',
  });
  try {
    const functionType = Number($('#functionType').value) || FunctionType.BACKGROUND;
    const results = await client.transferFileToAll(prepared.bytes, {
      fileType: FileType.IMAGE,
      functionType,
      allocateId: $('#allocMedia').checked,
      onProgress: (pct, detail) => {
        bar.style.width = `${pct}%`;
        if (detail?.perBadge?.length) {
          const bits = detail.perBadge
            .map((b) => `${b.name || b.sessionId} ${b.percent}%`)
            .join(' · ');
          bar.title = bits;
        }
      },
    });
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    toast(
      fail
        ? `Simultaneous push: ${ok}/${results.length} ok`
        : `Pushed to all ${ok} badges (simultaneous)`,
      fail ? 'err' : 'ok',
    );
    for (const r of results) {
      log({
        msg: r.ok
          ? `Push OK → ${r.name || r.sessionId} mediaId=${r.mediaId}`
          : `Push fail → ${r.name || r.sessionId}: ${r.error}`,
        level: r.ok ? 'ok' : 'err',
      });
    }
    renderSnapshot();
    client.requestMediaList().catch(() => {});
  } catch (e) {
    toast(e.message, 'err');
    log({ msg: e.message, level: 'err' });
  } finally {
    transferring = false;
    updatePushChecklist();
    setTimeout(() => {
      wrap.hidden = true;
    }, 900);
  }
}

function clearActiveUi() {
  renderSnapshot({
    name: null,
    model: null,
    firmware: null,
    hardware: null,
    software: null,
    manufacturer: null,
    battery: null,
    protocol: null,
    freeStorage: null,
    storageCapacity: null,
    mediaId: null,
  });
  $('#mediaList').innerHTML = '<div class="empty">Connect and refresh to load media.</div>';
  $('#mediaIdPill').textContent = 'Media ID —';
}

function bind() {
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnConnectAny').addEventListener('click', () => connect(true));
  $('#btnAddBadge').addEventListener('click', () => connect(false));
  $('#btnDisconnect').addEventListener('click', () =>
    client.disconnect().then(() => toast('Disconnected', 'ok')),
  );
  $('#btnDisconnectAll').addEventListener('click', () =>
    client.disconnectAll().then(() => toast('All badges disconnected', 'ok')),
  );
  $('#btnRefresh').addEventListener('click', () =>
    client
      .refreshIdentity()
      .then(() => {
        renderSnapshot();
        renderDeviceChips();
        toast('Device info refreshed', 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnPair').addEventListener('click', () =>
    client.pair().catch((e) => toast(e.message, 'err')),
  );
  $('#btnPickImage').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', () => rebuildPreview());
  $('#dialW').addEventListener('change', () => rebuildPreview());
  $('#dialH').addEventListener('change', () => rebuildPreview());
  $('#roundMask').addEventListener('change', () => rebuildPreview());
  $('#btnPush').addEventListener('click', () => pushImage());
  $('#btnPushAll').addEventListener('click', () => pushAll());
  $('#btnMediaList').addEventListener('click', () =>
    client.requestMediaList().catch((e) => {
      toast(e.message, 'err');
      log({ msg: e.message, level: 'err' });
    }),
  );
  $('#btnAllocId').addEventListener('click', () =>
    client
      .allocateMediaId()
      .then((id) => {
        $('#mediaIdPill').textContent = `Media ID ${id}`;
        toast(`Allocated ${id}`, 'ok');
      })
      .catch((e) => toast(e.message, 'err')),
  );
  $('#btnClearLog').addEventListener('click', () => {
    $('#activityLog').innerHTML = '';
  });

  client.addEventListener('log', (e) => log(e.detail));
  client.addEventListener('sessions', () => {
    syncConnectionChrome();
    renderDeviceChips();
  });
  client.addEventListener('connection', (e) => {
    syncConnectionChrome();
    renderDeviceChips();
    if (!e.detail.connected && client.sessionCount === 0) {
      clearActiveUi();
    } else {
      renderSnapshot();
    }
  });
  client.addEventListener('snapshot', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderSnapshot(e.detail.snapshot);
    }
    renderDeviceChips();
  });
  client.addEventListener('deviceinfo', () => renderSnapshot());
  client.addEventListener('disinfo', () => renderSnapshot());
  client.addEventListener('battery', () => {
    renderSnapshot();
    renderDeviceChips();
  });
  client.addEventListener('mediaid', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      $('#mediaIdPill').textContent = `Media ID ${e.detail.mediaId}`;
    }
  });
  client.addEventListener('medialist', (e) => {
    if (!e.detail.sessionId || e.detail.sessionId === client.activeId) {
      renderMediaList(e.detail.items);
    }
  });
}

function initSupport() {
  const secure = window.isSecureContext;
  if (!secure) {
    setPill($('#blePill'), 'Needs HTTPS (or localhost)', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
    log({
      msg: 'Insecure context — Web Bluetooth is blocked. Use GitHub Pages HTTPS or localhost.',
      level: 'err',
    });
    return;
  }
  if (SuperBandClient.supported()) {
    setPill($('#blePill'), 'Web Bluetooth ready', 'ok');
  } else {
    setPill($('#blePill'), 'Web Bluetooth unavailable', 'err');
    $('#btnConnect').disabled = true;
    $('#btnConnectAny').disabled = true;
    $('#btnAddBadge').disabled = true;
  }
}

const FALLBACK_VERSION = '2026.08.11.1';

function applyVersionLabel(version, builtAt = null) {
  const hero = $('#appVersion');
  if (hero) hero.textContent = version;

  const el = $('#buildMeta');
  if (!el) return;
  el.innerHTML = '';
  const a = document.createElement('a');
  a.href = REPO_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `Badge Manager v${version}`;
  el.appendChild(a);
  if (builtAt) {
    el.appendChild(document.createTextNode(` · ${builtAt}`));
  }
}

async function initBuildMeta() {
  applyVersionLabel(FALLBACK_VERSION);
  try {
    // Site-root version.json (written by Pages / local build), not next to the JS chunk.
    const res = await fetch(new URL('version.json', document.baseURI));
    if (!res.ok) throw new Error('no version');
    const data = await res.json();
    if (data?.version) {
      applyVersionLabel(String(data.version), data.built_at || null);
    }
  } catch {
    // Keep FALLBACK_VERSION from HTML / package.json.
  }
}

bind();
bindAdvanced({ client, log, toast, $ });
initSupport();
initBuildMeta();
syncConnectionChrome();
updatePushChecklist();
log({
  msg: 'Badge Manager ready. Connect a badge to select its display dimensions and image format.',
  level: 'info',
});
