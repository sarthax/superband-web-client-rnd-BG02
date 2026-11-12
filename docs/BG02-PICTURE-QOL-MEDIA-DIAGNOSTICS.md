# BG02 picture-editor QOL and media-library reconnaissance

Status: **draft**. This branch is stacked on
`feature/bg02-video-avi-workbench` (PR #7) and does not merge either PR.

## Picture QOL

The normal **Pictures** tab now offers:
- Zoom slider / wheel / pinch **25–400%**, matching the newer Video & GIF
  editor's ability to zoom *out* below the old 100% cover-crop. The original
  100% centered cover crop is still the default.
- Pan while zoomed out, within the unused black-margin space. The photo can
  remain smaller than the circle; black space is intentionally left around it.
- Source-file byte count and original pixel dimensions when known.
- Exact **BG02 RU50/ETC2 output byte count = 29,904 bytes**
  (1,104 byte header + 28,800 byte fixed ETC2 texture at 240×240).
- Four-byte Dial31 length-prefix counted in the tentative allocation hint:
  29,908 bytes transferred, approximately **32KiB** if the observed 8KiB
  rounding reflects a genuine allocation unit.
- Reported free bytes from the already working BG02 `0x20/4` read, and
  estimated free after upload. A low-space warning appears if the estimated
  allocation exceeds the last reported available bytes.

The 8KiB rounding is an **inference from observed free-space changes**, not a
proven filesystem block size. The size preview does **not** change picture
encoding or automatically change the picture currently shown on the badge.
Transfers still use the existing RU50/ETC2 path. No extra preflight BLE
traffic is sent just to display the estimate.

## Why the original media library was hidden on BG02

The original `mediaLibrarySection` and `MediaCmd` list/delete/allocate
implementation is still in the code. It uses **Baji** module frames and
parsing, rather than FitPro commands. `src/js/device-profile.js` explicitly
sets `showMediaLibrary: protocolMode === 'baji'`, so BG02 hides that panel
by design. The client also does not request Baji media entries after the
FitPro handshake.

**This is not proof that BG02 lacks stored-media management.** It means the
old Baji file-list/delete opcodes are not qualified for BG02.

Evidence:
- Successful SuperBand Android HCI capture for BG02 V1.5 shows FitPro
  `0x20/2` dial-info, `0x20/4` free-storage, and `0x1F` JPEG/AVI
  uploads, but **no verified stored-file listing/delete exchange**.
- External DG01 protocol work documents that some app watchface *catalogue*
  listings are driven by a server API, not a BLE read of all stored device
  files. Phone-side catalogue entries must not be mistaken for BG02 flash
  inventory.
- The `pictureNums` byte parsed from `0x20/2` may be a candidate count
  field, but its meaning is not validated against BG02 stored media.

## Added: BG02 read-only media diagnostics

The new experimental section is visible only when the active connected badge
has the known BG02/LJ733 V1.5 identity with FitPro protocol.

**Read badge media metadata** performs exactly two operations, both
previously seen in the user's Android snoop:
1. `0x20/2` — dial info (resolution, algorithm, candidate count byte).
2. `0x20/4` — free-media candidate bytes and raw word 0.

Results are displayed with their uncertainty plainly labeled. A local
**Export diagnostic JSON** button saves only non-secret model, firmware,
hardware, dial info and storage fields (no BLE MAC, serial, browser session ID).

This is deliberately **not a working file inventory**. It does not show
individual photo/video filenames or thumbnails, and **does not enable
delete/format/overwrite/OTA**. The old Baji library remains Baji-only.

To advance to a true media manager, the smallest useful next evidence is one
short Android btsnoop segment while using the **SuperBand app's installed
media / on-device file management screen** (open list, read, optionally delete
a disposable item on the phone with user approval). Decode that command and
its response *before* implementing any mutating action. A media-list
response would qualify read-only enumeration; a distinct verified
per-item-delete command and a post-delete storage check would be needed before
enabling deletion.

## Validation

`src/tests/picture-qol.test.mjs` covers photo zoom bounds, zoomed-out
pan limits, original center-crop default, exact RU50 byte count, 8KiB-rounded
hint and insufficient-space warning. The file is included in both existing
CI workflows. Hardware/visual behavior must still be checked in Chrome
or Edge, with no device write needed.

Safety boundaries: no deletion, media wipe, blind FitPro opcode scan,
firmware flash, or automatic photo change was introduced.
