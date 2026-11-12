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

A separate video panel accepts browser-playable MP4, WebM, or animated GIF, with source preview, start/stop trim markers, a **maximum length** of 5, 10, 15, 20 or 30 seconds, Low/Medium/High JPEG quality, and square crop or letterbox. Its default is **no repeat**: a 3-second selection with a 5-second maximum produces **9 frames / 3 seconds**, not a padded 15-frame video. Repeating the selected sequence to fill the cap is explicitly opt-in. Output is **240×240 / 3fps MJPEG AVI without audio**.

Existing compatible 240×240/3fps MJPEG AVI can also be imported and passed through **unchanged**, with a first-frame poster. This allows testing the BLE uploader using the exact recovered SuperBand AVI before testing the new browser encoder.

After encoding, it shows the **exact AVI byte count**, first-frame preview, probable 8KiB-rounded allocation, and the badge's last reported free space. Users can download the AVI and independently inspect it. Upload uses a separate FitPro Dial31 type=1 sender and requires a fresh 0x20/4 free-space query. Existing picture uploading is untouched.

Animated GIF decoding uses Chrome/Edge ImageDecoder (WebCodecs), which is not available in every browser. This app already requires a Web Bluetooth-capable Chromium browser. Unsupported input video codecs will fail with an explicit message. Chrome may not decode MJPEG AVI as source, even though the badge may accept that output.

The Repeat checkbox means **repeat frames inside the converted AVI** and is **off by default**. It does not configure the badge's separate slideshow or media-display time limit. Output durations are quantized to 1/3 second because the BG02 reference AVI uses 3fps; a short interval under one frame produces one frame.

### Select individual GIF frames

The optional **GIF frame picker** displays original composited GIF frames in pages of 24 thumbnails. Click to select or deselect; selections persist between pages. The selected frames are encoded in source order, not repeated, unless Repeat is explicitly enabled. Choose how long each selected frame remains on screen: **0.33, 0.67, 1 or 2 seconds**, corresponding to 1, 2, 3 or 6 MJPEG frames per selected image. The maximum clip duration still caps output.

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
