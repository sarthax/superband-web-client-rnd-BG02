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

A separate video panel allows selecting browser-playable MP4, WebM, or animated GIF; preview; start and stop markers; 5, 10, 15, 20, or 30 second output; Low/Medium/High JPEG quality; square crop or black letterbox; and loop the selected source segment to fill the chosen duration. It converts locally to **240×240 / 3fps MJPEG AVI with no audio**.

Existing compatible 240×240/3fps MJPEG AVI can also be imported and passed through **unchanged**, with a first-frame poster. This allows testing the BLE uploader using the exact recovered SuperBand AVI before testing the new browser encoder.

After encoding, it shows the **exact AVI byte count**, first-frame preview, probable 8KiB-rounded allocation, and the badge's last reported free space. Users can download the AVI and independently inspect it. Upload uses a separate FitPro Dial31 type=1 sender and requires a fresh 0x20/4 free-space query. Existing picture uploading is untouched.

Animated GIF decoding uses Chrome/Edge ImageDecoder (WebCodecs), which is not available in every browser. This app already requires a Web Bluetooth-capable Chromium browser. Unsupported input video codecs will fail with an explicit message. Chrome may not decode MJPEG AVI as source, even though the badge may accept that output.

The Loop checkbox means **repeat frames inside the converted AVI**. It does not configure the badge's separate slideshow or media-display time limit.

## Storage and safety

A real 29,904-byte picture consumed 32 KiB, consistent with allocation rounding in 8KiB increments. The upload preflight calculates ceil((AVI bytes + 4 length-prefix bytes) / 8192) * 8192 and compares it to the freshly queried 0x20/4 free bytes. This rounding is an *estimate* from the observation, not a proven flash geometry. If the storage check fails or there is insufficient space, the video upload is blocked. No delete, format, or OTA commands are added.

The app writer can generate up to **30 seconds / 90 frames** for exploratory testing. That is a software ceiling, **not** a claim about BG02 video playback support. All durations beyond 5 seconds require manual verification.

## Short acceptance test

1. Connect BG02 with DIS hardware LJ733_MB_V1.5 and verify free-space reading.
2. Choose a short GIF or browser-playable video, set 5s/Low, adjust trim, and click Convert & measure AVI.
3. Verify exact byte count and first frame. Optionally Download AVI and inspect with FFprobe: codec mjpeg, 240x240, fps 3/1, 15 frames.
4. If the file fits, upload; check all five seconds and loop behavior *on the badge*. The BLE finish ACK alone does not prove playback.
5. Only if 5s works, test 10s and then 15s. Do not test 20/30s before those pass.

No additional large capture campaign is needed for this first shakeout.

## Regressions

From the src directory:

- node --test tests/video-avi.test.mjs tests/fitpro-bg02-storage.test.mjs
- bun run build

The tests use synthetic JPEG marker frames for AVI structure; they cannot qualify browser-JPEG output or actual hardware playback.
