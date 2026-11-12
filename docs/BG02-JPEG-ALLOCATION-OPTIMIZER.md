# BG02 JPEG quality optimization within 8 KiB media allocations

User reported JPEG 4:4:4 stills saving >53% over RU50 with sharper text
on a physical BG02. The badge's free-space readings change in **8 KiB
allocation increments**. JPEGs around 12–19 KiB are therefore especially
sensitive to crossing the **16 KiB allocation threshold**.

## Main idea

JPEG bytes are variable length; choosing a "quality percentage" cannot predict
size across pictures, crops, or text/detail. Rather than choose 75–80% for
all images, **encode actual 240×240 baseline JPEG 4:4:4 candidates and select
the highest quality whose bytes fit a chosen allocation bucket**.

Dial31's 4-byte length prefix counts toward the stored transfer bytes:
- 8 KiB bucket: JPEG must be **≤8,188 bytes**
- 16 KiB bucket: JPEG must be **≤16,380 bytes**
- 24 KiB bucket: JPEG must be **≤24,572 bytes**
- 32 KiB bucket: JPEG must be **≤32,764 bytes**

The UI displays bytes and unused headroom. Nothing is padded to fill a bucket.

## Controls

Select **JPEG 4:4:4** in Pictures and use the usual 240px framing editor.

- **Convert & compare**: existing manual JPEG quality slider (now 1% increments
  from 35–90), plus the RU50/JPEG/source decoded preview.
- **Best quality in this block**: determines the current allocation (from
  current comparison or one JPEG measurement at the chosen slider quality),
  then chooses the highest tested quality 35–90 that fits **that same bucket**.
- **Use 8 KiB less**: tries the next smaller allocation bucket; may require
  a substantial quality reduction, and can fail if not even quality 35 fits.
- **Allow 8 KiB more**: allows quality to increase within the next allocation
  bucket, up to quality 90, without adding unused padding.

The result updates the JPEG quality slider, file-size/flash-allocation preview,
and the JPEG pane's actual decoded bitstream. The selected **already encoded
bytes** are sent if the user manually chooses Upload. No automatic uploads.

Each optimization performs a descending scan from 90 toward 35 and stops at
the first fitting quality. The JPEG entropy coding output does not have to
increase monotonically with the quality number, so a binary search alone would
not guarantee the highest fitting quality. The scan yields periodically so
the browser stays responsive; crop/session changes cancel stale results.
The existing single-pass CI covers exact boundaries, impossible targets,
highest fitting quality, and same-bitstream preview reuse.

## Example

If the current JPEG is **19 KiB**, it currently needs about **24 KiB** of
storage. Clicking **Use 8 KiB less** targets a ≤16 KiB allocation. If the
highest quality yielding at most **16,380 JPEG bytes** is 78, the editor
selects 78 and shows the new bytes. If even quality 35 exceeds the budget,
it reports that rather than silently changing the image or overflowing
the requested allocation.

Because free-space readings may include additional device metadata and
allocation behavior, displayed allocation amounts remain estimates; the
actual byte length of the generated file is authoritative.

## Safety

The existing RU50 and JPEG type-2 upload paths and identity/storage gates are
unchanged. The optimizer is **entirely offline**, does not upload, delete,
format, overwrite files on the badge, or modify any firmware. Physical-device
quality remains the user's decision after A/B comparison.

Branch is stacked on the draft JPEG still-picture PR (#9); no merges requested.
