# BG02 AVI storage optimizer

## Scope

The video/GIF editor already creates and previews MJPEG AVI. This slice adds
**one-click bounded quality optimization** using actual encoded AVI byte lengths,
and an optional comparison of the 1 fps and 3 fps modes.

It does not introduce new firmware commands, new codecs, stored-media listing,
file deletion or automatic uploads. It uses the exact existing
`convertVideoToBg02Avi` encoder and releases unused frame references.

## Usage

1. Open Video & GIF; choose a source, crop, trim and select a maximum duration
   of **five seconds** (the bounded optimizer only handles this cap).
2. Choose a starting JPEG quality (Low/Medium/High) and frame rate.
3. Choose **Best quality within current 8KiB block** or **one block less**.
4. Optionally select **Also measure 1 fps and 3 fps**; this runs up to
   six actual encodings and may take longer than a normal conversion.
5. Press **Optimize AVI**. Review the exact measured byte/estimated allocation
   summary for each successful candidate, the selected AVI, and its
   source-vs-encoded preview. Nothing is uploaded until **Upload video**.

The target allocation uses `ceil((AVI bytes + 4) / 8192) * 8192`, including
Dial31's four-byte length prefix. Optimizer trials are quality High → Medium
→ Low; they do not presume a linear quality/size relationship.

Within the selected allocation, results prioritize the **originally selected
FPS** then highest quality. Only if that FPS has no fitting candidate does it
switch to the alternative (preferring 3fps if both alternative rates fit).
Thus a 3fps low-quality result may be chosen over 1fps high quality. This is
intentional: temporal smoothness and still-image quality are different tradeoffs.
You can manually change FPS and optimize again to compare priorities.

If none of the measured variants fit, no AVI is selected for upload and the
panel suggests a larger block, lower FPS or a shorter clip. The Convert &
measure AVI button remains available for other settings, including 10–30s
experimental clips and 2/0.5 fps.

## Hardware evidence

- An original SuperBand Android AVI capture used **240×240, 3fps, 5 seconds**.
- The owner has reported **1fps playback working** on BG02 V35922.
- **2fps and 0.5fps** remain experimental; **duration beyond 5 seconds**
  also remains unverified. The AVI muxer does not guarantee playback rates
  on arbitrary BG02 firmware variants.

Following an ACKed AVI upload, a read-only FitPro `0x20/4` refresh reports
observed before/after free bytes and compares the delta with the allocation
prediction. A read failure does not turn a successful upload into a failure.
Replaced media may reclaim previously allocated blocks.

## Limits

- Presets are **Low/Medium/High**, not a continuous JPEG quality slider.
- Only original source clips up to the selected 5s cap are optimized.
- Selecting cross-FPS comparison may result in an AVI with a different
  frame rate than originally chosen; the selected fps control and preview
  are updated before manual Upload.
- All encoding runs locally in Chrome/Edge. There is no cloud transcoder
  and no background work.
- The on-device flash allocation model is empirical, not a proven filesystem
  block map.

Tests: `src/tests/video-storage-optimizer.test.mjs`, wired into both CI
workflows, plus the pre-existing AVI and video-timeline tests.
