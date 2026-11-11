# BG02 / LJ733: peer picture sharing and possible image readback

Status: **RESEARCH ONLY**. No BLE writes, firmware flashing, source changes to the working JPG/PNG → RU50 uploader, or claim of a verified BG02 readback API.

## Why this exists

The owner reports on **BG02, hardware LJ733_MB_V1.5, firmware V35922**:

- Browser crop/zoom → RU50/ETC2 still images transfer and render correctly.
- Official SuperBand app sends a short animated GIF that plays on the badge.
- On-badge **Share Picture** / **Receive Picture** modes scan nearby Bluetooth addresses. Selecting an unrelated nearby device says to put the other device into the opposite mode; the transaction does not begin.
- Windows Bleak scan locates BG02; GATT services include **7E40** UART (002 write, 003 notify, 004 read/write/notify), **3802 / 4A02** read/write/notify, **AA00 / AA01 / AA02** write/notify, **AE00** (JieLi OTA), and standard services.
- A separate Baji-only media list in our manager was intentionally hidden for FitPro/BG02; no BG02 list/readback command has been demonstrated.

This suggests peer-discovery plus a receiver-specific handshake, **not** a second MAC address or service necessarily. It does not establish the on-air file container, which side hosts the GATT server, or whether a phone can pull back stored files.

## Most relevant primary-source discovery: vendor AC707N badge demo

1. JieLi **707N Bluetooth peer image-transfer demo**:
   https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707N蓝牙互传图传demo/

2. JieLi **707 electronic badge development collection**:
   https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/

3. Public JieLi SDK source (**vanilla** `e_badge_707_sdk_200`, GitLab):
   https://gitlab.zh-jieli.com/e_badge/e_badge_707_sdk_200
   - Published SDK revision referenced by ElectronicCats: `d0167685d032d745d88fe50233302edd46941622`.
   - Beware: the peer-image-transfer demo may require a **patch/release newer than the public vanilla SDK**. Its docs refer to 200patch02, a v1.0.1 update, and a later LVGL edition; some download links in the vendor doc are struck through.

4. Third-party SDK setup/board notes:
   https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/docs/build-badge-firmware.md
   This independently identifies an AC707N / BR35 SDK and a different DG01 board; **do not flash its images onto BG02**.

### Vendor demo: explicit behavior

JieLi says its demo supports **AC707-to-AC707 transfer of still images and GIFs**, plus **phone → badge** image/GIF uploads. The demo's `壁纸互传` section states:

- One unit starts scanning and automatically connects to a second; the documented default selects a peer **by configured device name**.
- A **double-click action on the host** starts sending an image to the peripheral/secondary badge.
- Once transfer succeeds, the wallpaper is synchronized to the receiver.

That is consistent with the BG02 screen showing nearby device addresses and insisting that the target be in the opposite role. It is **not proof that BG02 V35922 uses byte-identical code**.

### Vendor wallpaper implementation clues

The JieLi demo identifies:

- `TCFG_JL_WALLPAPER_ENABLE` feature flag.
- `jl_wallpaper_add(const char *path, int path_length)` — add a local wallpaper by file path.
- `jl_wallpaper_set_by_name(char *name)` — select wallpaper.
- `jl_wallpaper_remove_using()` — delete currently used wallpaper.
- `jl_wallpaper_save(linked_list_t *list)` / `jl_wallpaper_load(linked_list_t *list)` — persisted list, stored in flash.
- The firmware scans a set of expected filenames/paths at boot, retains resources through wallpaper manager, and supports adding and deleting these entries.

These are **firmware-internal C routines**, not Bluetooth opcodes or remote readback functions. The JieLi test tool, per vendor doc, does **not** expose wallpaper add/delete directly; customers would need custom RCSP or custom BLE commands for those operations. Do **not** send guessed opcodes.

### App path is distinct from badge-to-badge path

Vendor docs state that **phone → device** wallpaper delivery uses JieLi **RCSP file-download**. `download` here is the SDK's word for phone sending bytes *down to the device*. It does not confirm device → phone file readback.

Our tested **FitPro Dial31** (`0x1F`) image upload still works, but should not be conflated with:
- Baji Media List/Preview/Background requests, which are **not** established on BG02 and may disconnect a FitPro badge;
- `AE00` JieLi OTA, which is for firmware update;
- an unknown AC707N **peer-to-peer image transport** (likely a distinct application state machine).

In the official resource comparison, a **188 KB input GIF** became **431 KB** as a converted JieLi UI GIF, **258 KB** as AVI (12 fps, 20 frames, quality level 3, no audio), and **252 KB** as JPG frames (same frame-rate/count). This was tested with vendor firmware **707v200patch02 + AVI patch** and is *not* a measured BG02 size/codec. It does support the owner's concern about limited space for animations.

- Resource comparison: https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/AVI-GIF-JPG三种方案资源占用对比.html
- APP SDK document: https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707_SDK-APP接口相关.html

The app-interface document identifies **JieLi_Health_SDK_Android_1.14.0_beta1+**, iOS **JieLi_Health_SDK_iOS_V1.12.0+** and vendor video-packing libraries; it says developers should request the materials from JieLi. These are **vendor SDK releases**, not confirmation of versions bundled in the current SuperBand APK. Vendor notes say GIF requires app-side conversion to JieLi's supported format, and AVI playback supports MJPEG video/PCM audio in its local-video demo.

## Specific code locations to inspect next (read-only)

1. Obtain the relevant **peer-sharing demo SDK source**, not just vanilla `e_badge_707_sdk_200`. Ask source search to find these exact symbols:
   `TCFG_JL_WALLPAPER_ENABLE`, `jl_wallpaper_add`, `jl_wallpaper_set_by_name`, `jl_wallpaper_remove_using`, `jl_wallpaper_save`, `jl_wallpaper_load`.
2. Trace **peer role entry**, advertiser/scan filtering by name, connection establishment, characteristic/service UUIDs, and the transition triggered by double-click or Share/Receive mode.
3. Identify the **file-streaming callbacks** and the source path that serves the active or selected wallpaper; record whether a file is copied intact or transcoded.
4. Separately review the RCSP **file-download-to-device** route and search for any *read-file / upload-to-phone* command. Do not infer one merely from the internal wallpaper list.
5. Cross-check discovered command IDs and GATT UUIDs against the user's BG02 services and any known V35922 firmware. No flashing or arbitrary writes.
6. If the **receiving peripheral contract** is complete, create a stand-alone PC/ESP32 receiver. Windows Bleak is a BLE *central/client*, not a generic BLE-peripheral/GATT-server implementation. Use BlueZ peripheral mode or suitable ESP32 firmware as necessary, with a capture-only receiver first.

### Optional single-pass source audit (no device access)

The repository includes `tools/scan_bg02_share_sources.py`. If the vanilla or peer-demo SDK sources are available locally, it ranks C/headers, Java/Kotlin, and other text files containing the exact vendor symbols and likely peer/RCSP roles:

```powershell
py -3 tools/scan_bg02_share_sources.py "D:\\Claude\\JieLi\\e_badge_707_sdk_200" --limit 30 --json "D:\\Claude\\scratch\\bg02-share-sources.json"
```

Provide the **directory containing extracted source files** (not an OTA zip or raw `app.bin`). The script is standard-library only, reads files without changing them, and reports candidate filenames and source line numbers. It never connects to Bluetooth. A zero-result scan of the vanilla SDK only means the feature might live in a separate demo patch or binary library.

## What to implement only after source proof

- A safe **Get stored media** command in the web manager, **if** a stock BG02 GATT readback service exists.
- Otherwise, a standalone receiver emulator if the peer handshake can be reproduced, capable of saving incoming encoded bytes with metadata and checksums. Keep that out of the browser until its Bluetooth role permits integration.
- Media listing, free space and deletion remain speculative on BG02 until separately established.
- Do not repurpose the Baji media list, fileType VIDEO or animation opcodes on FitPro.

## Scope and acceptance

**Now:** document exact upstream symbol paths and wire format with unambiguous source evidence; avoid repeated six-second scans, speculative BLE writes, or multi-hour traces.

**First end-to-end proof later:** user initiates Share Picture on BG02, PC receiver saves the byte stream, validates its header/length, and can re-upload/view it. A successful BLE connection alone is not enough.

The stock BG02 still-image branch / draft PR #3 must remain unchanged. This research branch intentionally derives from it; merge peer-share research separately.
