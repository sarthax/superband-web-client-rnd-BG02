# BG02 video and GIF conversion — experimental browser workbench

Status: **draft, not hardware-accepted**. Kept separate from the existing RU50/ETC2 picture chooser, cropper, and picture transfer.

## Verified SuperBand Android capture

The user's recovered AVI from the SuperBand app contains:
- RIFF AVI, Motion JPEG codec (mjpg), 240×240, 3 fps
- 15 frames, **five seconds**, 37,896 bytes
- FFmpeg Libavformat tag Lavf60.3.100
- FitPro Dial31 module 0x1F, type=1 for AVI, ID 5538, finish ACK status 2

**Five seconds is the only duration verified in the real capture.** SuperBand reportedly offers 5/10/15, but BG02 playback of 10/15/20/30 seconds is unconfirmed. Generated JPEG quality and RIFF layout need one hardware test. Our writer produces a conventional AVI hdrl+movi+idx1 container, not a byte-for-byte copy of the app.

## Video workbench

A separate video panel accepts browser-playable MP4, WebM, or animated GIF, with source preview, start/stop trim markers, a **maximum length** of 5, 10, 15, 20 or 30 seconds, frame rate **3 fps (reference), 2/1/0.5 fps (experimental)**, Low/Medium/High JPEG quality, and square crop or letterbox. Its default is **no repeat**: a 3-second selection with a 5-second maximum produces **9 frames / 3 seconds**, not a padded 15-frame video. Repeating the selected sequence to fill the cap is explicitly opt-in. Output is **240×240 / 3fps MJPEG AVI without audio**.

Existing compatible 240×240/3fps MJPEG AVI can also be imported and passed through **unchanged**, with a first-frame poster. This allows testing the BLE uploader using the exact recovered SuperBand AVI before testing the new browser encoder.

After encoding, it shows the **exact AVI byte count**, first-frame preview, probable 8KiB-rounded allocation, and the badge's last reported free space. Users can download the AVI and independently inspect it. Upload uses a separate FitPro Dial31 type=1 sender and requires a fresh 0x20/4 free-space query. Existing picture uploading is untouched.

Animated GIF decoding uses Chrome/Edge ImageDecoder (WebCodecs), which is not available in every browser. This app already requires a Web Bluetooth-capable Chromium browser. Unsupported input video codecs will fail with an explicit message. Chrome may not decode MJPEG AVI as source, even though the badge may accept that output.

The Repeat checkbox means **repeat frames inside the converted AVI** and is **off by default**. It does not configure the badge's separate slideshow or media-display time limit. Output durations are quantized to the chosen frame interval (0.33s at 3fps, 0.5s at 2fps, 1s at 1fps, and 2s at 0.5fps). For example, at **0.5 fps with a 5-second maximum**, only **2 frames / 4 seconds** fit. Generating a third would produce 6 seconds and exceed the limit. Very short intervals may require a minimum of one video frame.

### Select individual GIF frames

The optional **GIF frame picker** displays original composited GIF frames in pages of 24 thumbnails. Click to select or deselect; selections persist between pages. The selected frames are encoded in source order, not repeated, unless Repeat is explicitly enabled. Choose how long each selected frame remains on screen using **1, 2, 3 or 6 output frames**. At the reference 3fps those are 0.33, 0.67, 1 and 2 seconds. At experimental 1fps they become 1, 2, 3 and 6 seconds. At 0.5fps each video frame lasts 2 seconds and longer holds are capped by maximum clip length. The maximum clip duration still caps output.

For example, **5 selected frames × 0.33s = 5 AVI frames, 1.67s**. If held for 1s each, they produce **15 MJPEG frames, 5s**. Because MJPEG stores a complete JPEG for every output frame, fewer *distinct selected source frames* only save substantial space when the **total output frame count** is reduced. Holding a still frame for multiple output ticks repeats encoded JPEG data, so file size may not decrease nearly as much. The final AVI size preview is authoritative and the badge may still round file allocation.

The GIF selector uses the Chromium ImageDecoder's composited frames and frame timestamps. It does not generate an animated GIF file; it produces an AVI suitable for the verified BG02 video-transfer container.

## Storage and safety

A real 29,904-byte picture consumed 32 KiB, consistent with allocation rounding in 8KiB increments. The upload preflight calculates ceil((AVI bytes + 4 length-prefix bytes) / 8192) * 8192 and compares it to the freshly queried 0x20/4 free bytes. This rounding is an *estimate* from the observation, not a proven flash geometry. If the storage check fails or there is insufficient space, the video upload is blocked. No delete, format, or OTA commands are added.

The app writer can generate up to **30 seconds / 90 frames** for exploratory testing. That is a software ceiling, **not** a claim about BG02 video playback support. All durations beyond 5 seconds require manual verification.

## Short acceptance test

1. Connect BG02 with DIS hardware LJ733_MB_V1.5 and verify free-space reading.
2. Choose a short GIF or browser-playable video, set 5s/Low, adjust trim, and click Convert & measure AVI.
3. Verify exact byte count and first frame. Optionally Download AVI and inspect with FFprobe: codec mjpeg, 240x240, fps 3/1, 15 frames.
4. If the file fits, upload; check all five seconds and loop behavior *on the badge*. The BLE finish ACK alone does not prove playback.
5. Only if 5s works, test 10s and then 15s. Do not test 20/30s before those pass.

Additional regression checks: `tests/video-timeline.test.mjs` covers 3-second GIFs under the 5-second cap, explicit looping, a long source clipped to the cap, and selected frame holds without automatic padding. The GIF thumbnail UI and hardware playback still need an in-browser/on-device test.

No additional large capture campaign is needed for this first shakeout.

## Regressions

From the src directory:

- node --test tests/video-avi.test.mjs tests/fitpro-bg02-storage.test.mjs
- bun run build

The tests use synthetic JPEG marker frames for AVI structure; they cannot qualify browser-JPEG output or actual hardware playback.

## Experimental fractional AVI frame rates

The recovered successful Android AVI is **3 fps only**. This branch now offers
**2 fps, 1 fps, and 0.5 fps** explicitly marked experimental. The 3fps original
remains the default; the picture encoder and sender have not been changed.

The AVI encoder adjusts both `avih.dwMicroSecPerFrame` and the stream's
`strh.dwScale/dwRate` as an exact rational timebase:

| Selected rate | dwRate | dwScale | Frame interval | Frames under 5s cap |
|---|---:|---:|---:|---:|
| 3 fps (reference) | 3 | 1 | 0.333s | 15 (5.0s) |
| 2 fps (experimental) | 2 | 1 | 0.5s | 10 (5.0s) |
| 1 fps (experimental) | 1 | 1 | 1s | 5 (5.0s) |
| 0.5 fps (experimental) | 1 | 2 | 2s | 2 (4.0s) |

The UI previews the real output frame count/duration and frame-count reduction
relative to 3fps *before* encoding. The final AVI byte count remains the
authoritative encoding size, not a bitrate estimate. Fewer JPEG frames can
reduce bytes significantly, but 8KiB allocation rounding and image content
may limit actual recovered badge free space.

The inspector and separate video sender now accept the four rates, but a lower
rate requires **explicit user confirmation** before any transfer. **The device
may ignore the AVI header, play at 3fps anyway, truncate, or reject it.**
Do not use a successful BLE ACK as proof that playback duration is correct.

### Small hardware shakeout

1. Keep the existing 3fps picture/video pathways untouched.
2. With a short, unchanged source/quality, convert once at **3fps**, download
   the AVI and note its size and playback on the badge.
3. Convert the same selection at **1fps** (five seconds = five JPEG frames).
   Check downloaded AVI size; upload only if it fits the fresh storage query;
   check that each still remains for one second on the badge.
4. Only if 1fps behaves, optionally try **0.5fps**; a 5-second maximum
   produces **4 seconds**, not 6.
5. If lower fps clips play too quickly or don't display, retain 3fps as the
   operational baseline. Tests of GIF thumbnails and browser JPEG encoding
   remain manual device/browser checks.

Added targeted test coverage for all four AVI header timebases, 0.5fps clipping,
1fps GIF frame selection/holds, and the no-automatic-repeat rule.

## Hardware findings and browser preview update — 2026-11-11

User reports **two successful 1fps playback samples** on the BG02: the badge
honors the intended AVI header timing. A three-frame, **1fps / 3-second** AVI
encoded at **13.4 KB** compared with an approximate previous 60KB output from
the fixed-rate workflow. Those figures are user-observed, not a controlled
same-quality benchmark; the difference is nevertheless promising.

Status by frame rate:
- 3fps: supported in original recovered SuperBand AVI.
- **1fps: playback timing confirmed by user for two samples**.
- 2fps: not independently playback-confirmed.
- 0.5fps: **not tested** on the device.

Do not extrapolate to 0.5fps without a separate device check.

### Side-by-side comparison preview

After conversion, the Video & GIF tab now displays two synchronized 240x240
round previews: **sampled source frames before JPEG compression** and
**MJPEG frames extracted from the exact generated AVI bytes**.
Playback, pause, previous/next frame, and a shared scrub timeline all follow
the AVI's declared fps, including 1fps and experimental 0.5fps. This allows
offline quality/timing comparison before consuming any badge storage.

The browser does not need native AVI playback: we parse RIFF/movi frame
chunks, decode their JPEG payloads with `createImageBitmap`, and synchronize
display with pre-compression reference images retained during conversion.
For imported unmodified AVI, the left and right panes necessarily show the
same encoded pixels since no original source frames are available.
This is a **browser simulation of header timing**, not proof that each
unverified frame rate works on the badge.

The actual AVI bytes and the Bluetooth sender are unchanged by the preview.
Structural tests ensure the extraction preserves frame order and cannot mutate
the upload buffer. GIF browser decode and the visual preview controls still
require a manual browser check.

## Interactive GIF/video framing editor

Rectangular GIFs no longer have to use a fixed center crop. The Video & GIF
tab has a **240×240 circular crop preview** with drag-to-pan, wheel/slider
zoom (100–400%), two-finger pinch, and arrow-key panning. The underlying AVI
frames remain square MJPEG images, just as before; the circle is a UI mask
matching the round BG02 badge.

Editing uses a single source-coordinate-independent **240px crop transform**,
in the same spirit as the existing photo cropper. It supports both the
existing **Fill** (cover) and **Fit with black bars** (contain) choices.

There are two levels of framing:

- **Shared crop** (default): the fallback for every GIF frame, and the only
  cropping mode for ordinary MP4/WebM video trims.
- **Individual GIF frame crop**: selecting a frame from the paginated GIF
  thumbnails makes it active for crop editing. Use its separate **Edit crop**
  button to open a frame that is already selected without deselecting it.
  Adjustments to this frame create an override keyed by its original GIF
  frame index, independent of other selected frames.

The crop editor includes Previous/Next selected frame, zoom, Reset current
crop, Use shared crop for this frame (discard override), Apply to selected
frames (copy the current framing into each selected frame's override),
Apply to every GIF frame (set the current framing as the new shared crop and
clear all overrides), and Reset all framing.

**Consistency:** All paginated GIF thumbnails are generated with the same
crop math, source frame and fit mode as the AVI converter. During AVI
conversion, each sampled original GIF frame uses its own override when
present, otherwise the shared crop. The existing source-versus-encoded-AVI
comparison shows exactly those edited pixels before and after MJPEG
compression. Changing a crop invalidates the previously converted AVI so
the user must reconvert, see its new file size, and decide whether to upload.

The original animated GIF preview at the top remains deliberately
**unmodified reference footage**; the crop editor shows the active framed
source frame. The photo cropper and original picture transfer path are
unchanged, as are the BLE AVI sender, storage preflight, and duration rules.

New regression coverage: `src/tests/video-crop.test.mjs` verifies wide
rectangular source edge panning, crop bounds and focal zoom, copy semantics,
and identical 240px/thumbnail rendering coordinates.
