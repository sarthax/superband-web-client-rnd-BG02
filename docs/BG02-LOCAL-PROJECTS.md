# BG02 local editing projects and storage reporting

This feature is **browser-local and user initiated**. It never synchronizes media
between badges, changes their displayed photo, talks to an online account,
or requests a stored-media list.

## Save and restore projects

The Pictures and Video & GIF tabs now offer **Save project** and **Open project**.
A project is a ZIP with exactly two files:

- `project.json`: versioned editing state
- `source.bin`: the user-selected source picture, GIF or video, unchanged

For pictures, state includes JPEG/RU50 selection, quality and crop zoom/pan.
For videos and animated GIFs, it includes trim start/end, duration cap, FPS,
quality, crop fit, repeat setting, selected GIF frame indices/hold, shared
crop and individual frame overrides.

A project can be saved as a file and reopened on another computer. When
opened, the editor reloads the embedded source and editor settings; any
previously prepared JPEG/AVI is **invalidated**. The user must re-optimize
or reconvert and review again before uploading. **Opening never performs a
Bluetooth transfer.** Project ZIPs contain source media, which may be
sensitive; only save/share them intentionally.

ZIP imports are size-bounded (up to 64 MiB source and 128 KiB metadata),
require a known version/type/shape and exactly the two expected files;
unsupported project versions are rejected. No executable content is run.

There is **no browser IndexedDB library or cloud persistence yet**: project
files are intentionally portable, owned and backed up by the user. This
is the initial file-based save/restore workflow rather than a database.

## Prepared picture download

After **Optimize picture** or **Convert & compare**, download the exact
already-reviewed encoded bytes: `.jpg` for BG02 JPEG 4:4:4, `.ru50` for
RU50/ETC2. Download is local; no badge operation occurs.

## Observed BG02 picture storage change

After an acknowledged picture upload, the manager performs one additional
read-only `FitPro 0x20/4` query. When both before/after values are valid for
the same connected badge session, the UI shows:

- Reported free bytes before and after
- Actual reported delta (positive consumption / negative reclamation)
- Predicted 8KiB-rounded allocation for the encoded picture

The delta can differ from the prediction because a new picture may replace
an older one and free its blocks. A failed post-upload read cannot mark a
successful upload as failed. The count byte is still unverified; no hidden
file read/list/delete commands were added.

## Remaining work / intentionally excluded

- No IndexedDB auto-save, local persistent gallery or sync to multiple badges
- No firmware/OTA changes beyond the OTA lock in Slice A
- No transfer or deletion of media currently stored on the device
- No claims that browser projects are on-device file backups

See [README](../README.md), [picture codec research](BG02-JPEG-STILL-COMPARISON.md)
and [media diagnostics](BG02-MEDIA-LIST-FEASIBILITY.md).
