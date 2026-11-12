# BG02 experimental native JPEG stills versus RU50/ETC2

**Status:** browser implementation ready for local/manual A/B shakeout; **JPEG still playback on a physical BG02 V1.5 has NOT been confirmed.** Branch is stacked on the picture QOL + read-only media-diagnostics PR, and neither branch should be merged without review.

## Motivation

BG02 RU50/ETC2 is fixed-size: 240×240 at 4bpp gives 28,800 bytes of texture data plus 1,104-byte RU50 vendor header = **29,904 bytes**. A previous measured upload consumed about 32KiB of reported free space. ETC2 is compressed but its rate is fixed.

JPEG compresses adaptively. The successful 1fps MJPEG AVI experiment showed that simple decoded JPEG stills can be substantially smaller, but AVI uses **Dial31 type 1**, not the normal picture function. The user wants to keep native still-picture semantics. BG02's observed read-only dial info reports `algorithm=4`, and the existing FitPro implementation recognizes **Dial31 type 2** for JPEG, but **successful JPEG still upload/playback is still experimental**.

## Added UI

In the **Pictures** tab, after selecting a normal image and adjusting the existing 25–400% circular crop:

1. Choose `RU50 / ETC2 — current working default` or `JPEG 4:4:4 — experimental`.
2. Set JPEG quality (35–90; default 65).
3. Press **Convert & compare**. No Bluetooth writes happen here.
4. Inspect three simultaneously rendered 240px previews:
   - Source crop (uncompressed pixels)
   - RU50 decoded **from the actual ETC2 blocks produced by our encoder**
   - JPEG decoded **from the actual baseline JFIF 4:4:4 file bytes**
5. Read exact byte sizes, estimated 8KiB-rounded allocations, and percent JPEG savings.
6. Select either format. Upload uses only the **already-previewed exact bytes**; it will not re-encode secretly.

Changing the crop or JPEG quality invalidates old compressed bytes and disables upload until **Convert & compare** is run again. New photos default back to RU50. Existing imported `.ru50` pass-through, Baji/other badges, GIF/AVI, and read-only library diagnostics are unchanged.

## Codec implementation

- `src/js/picture-comparison.js`: encodes 240×240 crop through existing `encodeImageDataRu50` and `encodeBaselineJpeg444`. JPEG must pass `describeJpeg` checks, be JFIF baseline, 4:4:4, exactly 240×240, and have complete JPEG EOI marker.
- `src/js/etc2.js`: an ETC1 individual-mode decoder to show the *actual* decoded RU50 pixels. This is not a general-purpose ETC2 decoder and rejects unsupported block modes. It is appropriate for **our** known ETC1-subset encoder.
- `src/js/picture-size.js`: now computes storage estimates from **actual** measured JPEG lengths, while preserving the known fixed RU50 byte count.

The simulated circle is a display mask; the stored texture/JPEG is a full 240×240 square with black transparent-outside-crop pixels (same behavior as the old photo editor). Browser JPEG output may differ from the badge's decoder, so evaluate the actual badge after transfer.

## Guarded JPEG transfer

RU50 keeps the original Dial31 type-0 path.

JPEG must be explicitly selected and confirmed by the user. The new `transferBg02Jpeg` method requires:

- connected FitPro session on **LJ733_MB_V1.5** with known BG02/LJ733 advertised identity;
- read-only `0x20/2` reports `algorithm=4`, selecting Dial31 picture type 2;
- exactly 240×240 baseline JFIF JPEG 4:4:4 validated *before writing*;
- a fresh `0x20/4` free-space read and a fit check against the estimated 8KiB allocation.
 
Only then does it call the existing Dial31 transfer/ACK machinery. No generic dial-type override was enabled. This is a picture operation and can change the device's current picture, but never happens automatically. A BLE success response is **not** confirmation that the device actually shows or retains the JPEG.

A first trial should compare a simple picture at e.g. JPEG quality 65 with the RU50 version, optionally download/review sizes, upload **only one JPEG** after confirmation, and visually verify its display and persistence. Compare the free-space delta from the post-upload storage read. If rejected or visually poor, return to RU50 default. Avoid repetitive uploads on a nearly full badge.

## Limits

- The JPEG path is **not** equivalent to the proven 1fps AVI path; dial type 1 and type 2 may be interpreted differently by firmware.
- The JPEG 4:4:4 encoder may produce larger files than MJPEG captured at a different subsampling rate/quality. Sizes are measured per image.
- 8KiB allocation rounding is an empirical estimate, not flash-geometry proof.
- Browser preview validation and codec tests do not replace the first physical-device JPEG playback check.
- No firmware, OTA, delete, wipe, or media-list operations were added.

Focused tests: `src/tests/picture-compare.test.mjs`; included in existing single-pass Validate and Pages workflows.
