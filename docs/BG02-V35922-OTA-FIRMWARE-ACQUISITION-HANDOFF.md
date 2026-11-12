# BG02 V35922 firmware / OTA acquisition — local-agent technical handoff

**Prepared 2026-11-12.** This is a historical evidence handoff, not an
instruction or authorization to flash. The owner's hardware is a **BG02**,
GAP names `BG02` or `LJ733_V1_BadgeOK`, DIS hardware
`LJ733_MB_V1.5`, firmware `V35922`, 240×240. The objective is to
**obtain a verified, compatible copy of the stock firmware for offline
inspection**, ideally without writing to the badge. This is distinct
from the read-only media-list investigation.

## Executive verdict

**Exact BG02 V35922 firmware image: NOT OBTAINED.**

This is not a blanket failure to reverse-engineer OTA. We recovered the
SuperBand application's update logic, the real OTA catalogue/API
contract, working downloads for **different LJ733-family badges**,
their ZIP→`app.ufw` packaging, and physical GATT support for AE00.
The unresolved questions are: (1) where a matching BG02 V1.5 firmware
artifact is hosted or archived, (2) whether it is only addressable using
a **predecessor** firmware version rather than the installed V35922,
and (3) whether the firmware/RCSP authentication implementation on the
BG02 differs from related badge variants.

**No exact V35922 ZIP/UFW, matching SHA-256, confirmed original BG02
factory dump, successful BG02 firmware download, or BG02 OTA flash has
been established.** Never label BJ-1 or DG01 firmware as BG02 firmware.

## Confirmed stock firmware and device characteristics

| Feature | Evidence / confidence |
| --- | --- |
| Installed FW | DIS `0x180A/0x2A26` reads ASCII `V35922` — confirmed live |
| Board | DIS `0x2A27` reads `LJ733_MB_V1.5` — confirmed live |
| Screen | FitPro `0x20/2`: 240×240, `K66` / `LJ733`, alg 4 (JPEG) |
| Application data | Working FitPro/Dial31 uploads on `7E400001`; unrelated to OTA |
| RCSP service | `0000AE00-0000-1000-8000-00805F9B34FB`, confirmed on BG02 |
| AE01 | `writeWithoutResponse` — GATT characteristic capability confirmed |
| AE02 | `notify` — GATT characteristic capability confirmed |
| RCSP identity query | Single opt-in `GET_TARGET_INFO 0x03` timed out at five seconds; no matching reply; no OTA operation sent |
| AC707N SoC | Identified by **related** LJ733-family UFW analysis; exact BG02 chip package not independently dumped |
| Media storage | FitPro `0x20/4` second BE32 changes in 8KiB increments; not a firmware readback interface |

The correct RCSP presence does not prove RCSP auth, OTA handshake, or
file readback. The first timeout could mean authentication gating,
unsupported command, or an unmatched response; later diagnostic code
in PR #12 counts AE02 notifications without revealing identity payloads.

## Original SuperBand Android APK recovered/analyzed

**App:** SuperBand **2.1.25**, Android package
`com.legend.smartwatch.electronicbadge.android`.

Relevant decompiled classes identified in the upstream research:
- `xfkj/fitpro/activity/ota/api/HttpHelper.java`:
  `getOTAUpgradeInfo`, request headers and catalogue lookup.
- `xfkj/fitpro/activity/ota/OTAHelper.java`:
  download and unzip firmware package.
- `xfkj/fitpro/activity/ota/manager/OTASDKManager.java`:
  service/OTA SDK coordination.
- `xfkj/fitpro/activity/ota/JliOTAActivity.java`:
  JieLi device-authenticated OTA frontend; calls
  `setUseAuthDevice(true)`.
- `xfkj/fitpro/activity/ota/OTAProxyUtils.java`:
  `plarmType == 7` routes through JieLi OTA.
- Companion classes/paths may reference `FileTransferService`
  and `BajiProtocolManager`, but the Baji file module does **not**
  establish the BG02 OTA path.

**Important:** decompiling an APK gives client logic and perhaps SDK
libraries; it does **not** yield the stock BG02 `app.ufw`. Inspection
found speech/TTS/VAD assets but **no complete badge firmware image
bundled in the APK**. The app expects to retrieve the update ZIP from
the server when a catalog entry is available. An OTA UI is therefore
not proof that the installed version can be downloaded.

For an agent with its own authorized APK: use jadx/apktool locally and
inspect the exact bytes, especially the OTA request, authentication
settings, response parser, CDN URL selection, and firmware cache
behavior. Don't assume the APK bytes are checked into the repo.

## Documented firmware update chain

1. Connect to badge, read its advertised Bluetooth name and DIS
   firmware revision (`0x2A26`, here `V35922`).
2. The SuperBand app makes a firmware-update catalogue request:
   `GET https://tomato.gulaike.com/api/v1/config/app?name={btName}&type=1&version={currentFw}`.
   The Android app sends an embedded authorization header plus
   `app-type`, base64 `app-name` (its package ID), `app-version=2.1.25`,
   and `country=foreign`. **Do not copy the token into a public PR or
   diagnostic export; the repo's research script already contains it.**
3. When a **matching current-version catalog row** exists,
   `data.app_down_url` (sometimes `appDownUrl4g`) points to a
   CDN-hosted ZIP, typically `/0ta/LJ733/...`.
4. The app downloads the ZIP and extracts `app.ufw`. A `force`
   value of `1` controls a **mandatory-update UI path**. It is NOT a
   "force download this firmware version" API parameter.
5. Only after package validation would JieLi's RCSP OTA SDK
   authenticate and transfer firmware via service `AE00`,
   write `AE01`, notify `AE02`. This last step was **not performed
   on the owner's BG02**.

**Crucial catalogue trap:** `version` is a **source/current version
key**, not necessarily the version of the ZIP returned. For example,
query `V32294` provides a ZIP for **V32399**; querying `V32399`
can return `data: null`. Similarly a device shipped on `V35922`
may legitimately receive no update offer, even when that firmware was
previously available as a target from an older version.

The catalog was observed to largely ignore `name` for some source
version keys. This is **not** compatibility evidence; it can return a
different manufacturer's firmware. Do not use the catalogue's generic
`name=LJ733` alone to select a flashing image.

## Versions/packages we *did* recover for comparison

| Catalogue query (current FW) | ZIP target | OEM designation / board family | Usage |
| --- | --- | --- | --- |
| `V32172` | `V32286` | `LJ733_V1.2_ZX400_BJ-1_SUPERBAND` | Offline comparative analysis ONLY |
| `V32294` | `V32399` | `LJ733_V1.2_YJ435_DG01_SUPERBAND` | Offline comparative analysis ONLY |
| `V27423` | `V27550` | older LJ733 row | Compatibility with BG02 unknown |
| `V34250` | `V34574` | `LJ733_V1.1_HYX004_HYX_ZTFITPRO` | Not a BG02 image |
| `V32449` | `V34576` | `LJ733_V1.1_HYX004_HYX_ZTFITPRO` | Not a BG02 image |

Examples of **known other-device** URLs:
- BJ-1: `https://cdn.jusonsmart.com/0ta/LJ733/V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip`
- DG01: `https://cdn.jusonsmart.com/0ta/LJ733/V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip`
- HYX `V34574`: `https://cdn.jusonsmart.com/0ta/LJ733B/V34574_A05271020_LJ733_V1.1_HYX004_HYX_ZTFITPRO.zip`

DG01 research receipts (verify if re-downloaded rather than assuming
bytes remain unchanged):
- ZIP size: **3,900,911 B**, SHA-256
  `9fc02aec53c6faaf60b86831dce5227c675d4b9fac74e0f14933022df4bd2ec4`
- `app.ufw` size: **4,237,888 B**, SHA-256
  `176b43da70115a1368548fc2ebd370a60cf01aa10fb4ac27ecbecf4b9cb398e1`

Those extracted LJ733 V1.2 packages identify **JieLi AC707N**,
`$B165` chipkey, `uboot.boot`, `isd_config.ini`, `app.bin`,
`p11_code.bin`, `cfg_tool.bin`, `config.dat`, SPI NOR UI/media
and OTA/updater symbols. DG01/BJ-1 share portions of the firmware
platform but their **`app.bin` variants and flash/resource layouts
differ**. The existence of a related binary does not guarantee V1.5
hardware compatibility, correct LCD, bootloader, GPIO, filesystem
layout, keys, or game/UI resources.

## Why acquiring a V35922 copy stalled

1. We **did find the catalog, authentication headers, working
   cross-model downloads and standard `app.ufw` extraction**.
2. A query using **current version `V35922`** did **not** return
   a firmware update URL. No confirmed predecessor-version key
   pointing to a V35922 ZIP was found.
3. Guessing common OTA CDN filenames is not reliable: files contain
   build timestamps, OEM tags, board revision and product variants.
   A failed guessed filename is not proof the image doesn't exist.
4. HCI snoop captures are **BLE only**; they show DIS `V35922`
   and ordinary FitPro image/video traffic but **no AE01 firmware
   data writes or AE02 RCSP OTA session**. They cannot reveal a
   separate HTTPS catalogue response or missing ZIP.
5. The Android APK contains **update client code, not a full V35922
   `app.ufw`**.
6. An authenticated OTA transport doesn't expose a known standard
   firmware **readback/dump** API. Our read-only `GET_TARGET_INFO`
   timed out; we did not try unauthorized auth guesses, download mode,
   USB readback, or a firmware flash. The original installed ROM is
   not currently backed up.

This must be reported as **"exact stock image not obtained"**, not
"the chip cannot be updated", "firmware isn't on the server", or
"the OTA server is inaccessible".

## Existing repo tools (read-only first)

- `tools/probe-ota.mjs`: prints catalog JSON (Bun) and
  `OTA_URL` if an offer exists.
- `tools/download-firmware.sh`: download/inspect archives;
  output `research/firmware/` (gitignored).
- `tools/analyze-firmware.sh`: unpack related UFW for offline analysis.
- `tools/unpack-apk.sh`: APK extraction/decompilation setup.
- `src/js/ota-catalog.js`: browser catalogue client, known BJ-1 and
  DG01 presets.
- `tools/send-ota-ble.py` with `probe` action: **GATT discovery
  only**. Its `flash` action is **not authorized for this task**.
- `src/js/jieli-ota.js`: older experimental RCSP OTA sender with
  **incorrect/unqualified framing** for the documented RCSP envelope.
  **DO NOT invoke `runJieliOta` on the BG02**. The isolated read-only
  `src/js/bg02-rcsp-target-info.js` uses the documented frame but
  did not elicit a matching response on the device.

Read-only examples (from repository root; use a local environment with
network access):

```bash
bun tools/probe-ota.mjs --name BG02 --version V35922
bun tools/probe-ota.mjs --name LJ733_V1_BadgeOK --version V35922
# Historical, known-other-device control: shows catalog request shape.
bun tools/probe-ota.mjs --name BJ-1 --version V32172
# No BLE traffic, no firmware flash.
```

Another user-owned standalone script, `badge_ota_recon.py`, was
prepared for offline catalog probing, optional explicit downloads and
ZIP/UFW signature/string analysis. It was not verified to reside in
the repository; look for it in the owner's local work/files and don't
assume it is checked in. Its safe default query is
`LJ733_V1_BadgeOK / V35922`; it restricts download domains to known
JusonSmart firmware hosts. It does **not** use Bluetooth.

## Best next investigation for the local Windows agent

1. **Find existing artifacts first**: local original SuperBand APK,
   decompiled jadx tree, `badge_ota_recon.py`, HCI capture,
   `research/firmware/`, any downloaded `app.ufw` or ZIP; record SHA-256.
   Do not mistake BJ-1 or DG01 caches for BG02.
2. **Trace `HttpHelper.getOTAUpgradeInfo` and OTA version negotiation**
   directly in original APK code: source of `name`, DIS revision,
   app-version, region, optional branch/version fields, and any
   alternate catalog URLs. Compare to our static `tools/probe-ota.mjs`.
3. Look for **legitimate, already available sources** of exact V35922:
   OEM/JusonSmart resources, firmware archives or user-provided
   backup; inspect catalogs for **confirmed BG02 predecessor-version
   chains**. Don't brute-force large version ranges or hammer the
   vendor endpoint.
4. If a candidate image is found, **download for offline analysis
   only**. Validate ZIP, `app.ufw`, full hash, SoC/chip ID, board
   revision, bootloader config, LCD/touch, partition/resource map and
   model tags against BG02 V1.5. Classify as
   `EXACT_BG02_VERIFIED` vs `SAME_FAMILY_ONLY` vs `UNKNOWN`.
5. Independently trace whether the **stock SuperBand APK uses
   AE00 for BG02 updates** and how RCSP authentication is initialized
   for V1.5. Authentication details are relevant to explaining
   the timeout but do **not** justify flashing.
6. If no V35922 source appears, produce a short blocker report with
   all proven lookup inputs/results. **Do not turn this into an
   open-ended BLE/HTTP fuzzing campaign.**

**Never flash, force bootloader mode, run UART/USB forced update,
write raw NOR, erase user media, downgrade, or test unrelated
firmware.** Use one local agent and one compact report rather than
many micro-probes. Do not publish API credentials or raw device IDs.

## Evidence references

Repo:
- `docs/protocol/ota-firmware.md` — original SuperBand app logic,
  current-version catalog lookup, confirmed examples and hashes.
- `docs/protocol/firmware-hw.md` — AC707N and extracted
  DG01/BJ-1 flash image differences.
- `docs/protocol/security.md` — token, cross-SKU mismatch and
  legacy USB/UART recovery risks.
- `docs/BG02-MEDIA-LIST-FEASIBILITY.md` — physical AE00 evidence,
  one-shot RCSP timeout, no firmware auth established.
- `docs/BG02-LOCAL-AGENT-HANDOFF.md` — separate media-listing work.
- `tools/README.md` — available scripts and environment.

External:
- Original upstream browser research:
  https://github.com/T-REX-XP/superband-web-client-rnd
- JieLi OTA / RCSP documentation:
  https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/api/rcsp_basic_api.html
- JieLi auth and SDK setup:
  https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/import.html

## Concise completion contract

Report:
- `BG02_V35922_IMAGE_FOUND_AND_VERIFIED`, or
  `RELATED_IMAGE_ONLY`, or `NO_EXACT_BG02_IMAGE_AVAILABLE`.
- Proven catalog query response(s) and precise source of the
  original/current firmware version.
- Candidate ZIP/UFW URL (if legitimately identified),
  sizes and SHA-256, evidence of board and FW match.
- Whether any RCSP auth/file traffic was observed in original
  app/HCI; no assumption that OTA traffic is automatically present.
- Confirmation that **no device firmware or media was changed**.
- A single next blocker (e.g. predecessor version, authorized vendor
  image, or an actual known BG02 firmware backup).
