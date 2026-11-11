# BG02 / LJ733: peer picture sharing and possible image readback

Status: **RESEARCH ONLY**. No BLE writes, firmware flashing, source changes to the working JPG/PNG → RU50 uploader, or claim of a verified BG02 readback API.

## Second Android bugreport: attempted badge-to-badge modes (2026-11-11)

The user's second Android full bugreport includes all **4,612** previous HCI packets as a **byte-for-byte prefix**, followed by **4,527 new** packets (to 9,139). There are **462 additional** BLE advertising reports. The new period captures repeated Android-phone reconnections to BG02; the final connection used **39 writes to FitPro UART 7E400002** and **35 notifications on 7E400003**, but **no new 0x1F image data, AE01 RCSP commands, AE02 subscriptions, or visible `wallpaper_adv`/new BG02-named advertisement**. Several phone connections failed with reported GATT statuses 8, 147 and 133.

The user was trying the badge's Send/Receive UI, but **the phone's HCI log cannot capture an independent badge-to-badge GATT exchange**. Therefore this does **not** establish failure or success of the peer transfer. The existing scanner or external over-the-air sniffer remains the right next evidence source; repeated RCSP queries will not help. See the [sanitized delta report](BG02-ANDROID-HCI-PEER-MODE-2026-11-11.md).

## Android full bug report — actual HCI traffic (2026-11-11)

The owner's Android 16 bug report contains a valid HCI snoop log (**4,612 records**, **1,055,441 bytes**) and SuperBand app logs. It shows BG02 discovered and connected, then a **successful SuperBand JPEG upload from phone to badge** on **7E400002/003**, with `0x1F` upload packets and `0x20` status acknowledgments **1000–1002**. There were **no AE01 writes or AE02 notification subscriptions** in this phone session and no observed peer-sharing transfer. This is not contradictory to the separately authenticated Windows probe.

**Privacy-safe evidence:** [BG02 Android HCI report](BG02-ANDROID-HCI-BUGREPORT-2026-11-11.md). The raw user bug-report ZIP is **not** in GitHub because it contains sensitive Android device/app data and uploaded image bytes. Android's own Bluetooth HCI snoop **cannot capture an independent BG02-to-BG02 session**, so do not interpret the missing peer traffic as disabled sharing. No `wallpaper_adv` advertisements were observed, but no controlled Receive-mode phase label was provided.

## Current next gate: passive receiver advertisement comparison (2026-11-10)

**Updated hardware evidence:** The owner successfully completed the six-step JieLi AE00 authentication repeatedly, including with BG02 Send and Receive Picture selected. The `GET_TARGET_INFO` `0x03` command then generated **zero AE02 post-auth notifications**, timing out. A locally modified probe added `--raw-log`; that local code is **not** in this GitHub branch. Do not pull/reset/overwrite the user's in-progress instrumented files or repeat the authenticated query without new evidence.

**Why this path:** JieLi's [707N peer-image-transfer demo](https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707N蓝牙互传图传demo/) shows that one badge scans/initiates a connection and chooses a peer by advertising name. The demo calls the peer `wallpaper_adv`, but **we have not confirmed that name, the advertisement payload, or the BLE roles on stock BG02 V35922**.

Implemented `tools/bg02_peer_advertisements.py`: **one passive, two-phase Windows Bleak advertisement capture**. It scans for 12 seconds with BG02 on its normal display, prompts the user to enter **Receive Picture**, then scans 15 more seconds. It compares advertisers, visible local names, UUIDs, manufacturer *IDs*, and hashes/lengths of advertising data. This only scans advertisements; it does **not** connect, enable notifications, authenticate, send RCSP, initiate a transfer, or alter badge files. Raw MAC addresses and advertising payloads are omitted from the output; device identities are hashed for phase matching. A receiver role may not advertise at all, and nearby devices create noise: absence of a difference is **not evidence that peer sharing is unsupported**.

**Run once on Windows from the project root**, with SuperBand and the browser manager disconnected:

```powershell
cd D:\Claude\superband-bg02-research
git fetch origin
# Restore ONLY the new scanner file from the PR branch, preserving existing local probe edits.
git restore --source=origin/research/bg02-peer-share-readback -- tools/bg02_peer_advertisements.py
uv run --native-tls --with bleak python tools/bg02_peer_advertisements.py --output "D:\Claude\scratch\bg02_peer_adv.json"
```

The scanner prompts at the normal→Receive transition. The same report can be summarized offline with `py -3 tools/bg02_peer_advertisements.py --inspect "D:\Claude\scratch\bg02_peer_adv.json"`. **Share the console summary first**, not raw logs. This is a new, distinct receive-advertisement probe, *not* a repeat of the empty AE02 notification experiment. [CI verification of five offline checks](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42969538978) passed.

**Decision after capture:** A distinctive changed/added receiver advertisement can guide a capture-only Android or ESP32 peripheral emulator. If no relevant advertisement appears, prioritize obtaining the JieLi **200patch04** peer-sharing module or arranging a real two-badge transfer before claiming we know the receiver's contract. Never guess file-transfer commands or treat generic SDK wallpaper examples as stock BG02 proof.

## Why this exists

The owner reports on **BG02, hardware LJ733_MB_V1.5, firmware V35922**:

- Browser crop/zoom → RU50/ETC2 still images transfer and render correctly.
- Official SuperBand app sends a short animated GIF that plays on the badge.
- On-badge **Share Picture** / **Receive Picture** modes scan nearby Bluetooth addresses. Selecting an unrelated nearby device says to put the other device into the opposite mode; the transaction does not begin.
- Windows Bleak scan locates BG02; GATT services include **7E40** UART (002 write, 003 notify, 004 read/write/notify), **3802 / 4A02** read/write/notify, **AA00 / AA01 / AA02** write/notify, **AE00** (candidate JieLi RCSP transport, also used in firmware-update workflows), and standard services.
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
- `AE00` JieLi **RCSP** service in official SDKs (which also transports OTA operations); its presence alone does not establish BG02 file browsing;
- an unknown AC707N **peer-to-peer image transport** (likely a distinct application state machine).

In the official resource comparison, a **188 KB input GIF** became **431 KB** as a converted JieLi UI GIF, **258 KB** as AVI (12 fps, 20 frames, quality level 3, no audio), and **252 KB** as JPG frames (same frame-rate/count). This was tested with vendor firmware **707v200patch02 + AVI patch** and is *not* a measured BG02 size/codec. It does support the owner's concern about limited space for animations.

- Resource comparison: https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/AVI-GIF-JPG三种方案资源占用对比.html
- APP SDK document: https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707_SDK-APP接口相关.html

The app-interface document identifies **JieLi_Health_SDK_Android_1.14.0_beta1+**, iOS **JieLi_Health_SDK_iOS_V1.12.0+** and vendor video-packing libraries; it says developers should request the materials from JieLi. These are **vendor SDK releases**, not confirmation of versions bundled in the current SuperBand APK. Vendor notes say GIF requires app-side conversion to JieLi's supported format, and AVI playback supports MJPEG video/PCM audio in its local-video demo.

## Evidence recovered directly from vendor code screenshots (2026-11-10)

The JieLi 707N sharing-demo page embeds screenshots with **actual C source names and statements**. These screenshots are useful, but were taken from the **JieLi demo**, not BG02 V35922.

| Exact demo location / symbol | Observed behavior / meaning | Evidence |
|---|---|---|
| `apps/common/ui/lcd/lcd_ui_api.c` (around 571) | A UI key handler invokes `ble_client_module_enable(1)` for peer discovery | [demo screenshot](https://doc.zh-jieli.com/KDocs/master/assets/img/img_6.b105597a.png) |
| `apps/watch/board/br35/board_ac707n_demo/board_ac707n_demo_cfg.h` | `TCFG_JL_WALLPAPER_ENABLE` enabled; `TCFG_JL_WALLPAPER_ADV_NAME` is set to **`"wallpaper_adv"`** | [demo screenshot](https://doc.zh-jieli.com/KDocs/master/assets/img/img_7.ea2da850.png) |
| `apps/common/ui/lcd/lcd_ui_api.c` (around 606–612) | `jl_wallpaper_sharing_send(void)` is posted as a callback to the `app_core` task | [demo screenshot](https://doc.zh-jieli.com/KDocs/master/assets/img/img_8.366d4975.png) |
| Editor tabs in the demo | Source modules `wallpaper_sharing_main.c` and `wallpaper_sharing.h` exist in the demo | [demo screenshot](https://doc.zh-jieli.com/KDocs/master/assets/img/img_6.b105597a.png) |
| Wallpaper management data structures | A linked list holds local **wallpaper file paths**; config references `storage/virfat_flash/C/` and `wp_cfg.bin` with a demo maximum of **100** items (not a BG02 capacity claim) | [demo screenshot](https://doc.zh-jieli.com/KDocs/master/assets/img/img_10.2427c024.png) |

**Implications:** the demo receiver can be identified by an advertisement name, and the sender's scan is explicitly enabled by UI code. `wallpaper_adv` is a **demo build option**, not a verified required name on BG02. We **do not** have the complete `wallpaper_sharing_main.c` body, packet layout, UUIDs, or incoming data handler, so claiming a working PC receiver from these snippets would be premature.

**Source availability:** the vendor page links old ZIP releases using struck-through links, and the public GitLab repository was unavailable from this environment. The independently verified vanilla SDK commit `d0167685d032d745d88fe50233302edd46941622` belongs to the *baseline SDK*, whereas the peer-sharing demo is described as **200patch02 or later**. A vanilla SDK tree may not contain these demo functions. Do not use a public firmware image from another board.

## Alternative first-choice research track: RCSP on-device file browsing/readback

The official open-source **JieLi Android Bluetooth SDK** documents `IFileOp` methods (SDK v4.2.0):

- `getOnlineStorage()` — list exposed storage volumes.
- `listFiles(device, folder, offset, readNum, callback)` — list file metadata, 1–30 entries per page.
- `readBigFile(ReadFileParam, OnTaskStateListener)` — receive file bytes from a device.
- `createBigFile(...)` — send file to a device.
- `deleteFile(...)` and `formatStorage(...)` — **destructive** operations; out of scope.

Primary SDK interface:
https://github.com/Jieli-Tech/Android-JL_Bluetooth/blob/main/doc/JieLi_Home_SDK_V4.2.0_html_en/html/_sources/development/api/file_op_api.rst.txt

SDK documentation of directory browsing:
https://github.com/Jieli-Tech/Android-JL_Bluetooth/blob/main/doc/JieLi_Home_SDK_V4.2.0_html_en/html/_sources/development/function/file_browse_func.rst.txt

Example app implementation (`FileBrowseManager` for storage/music):
https://github.com/Jieli-Tech/Android-JL_Bluetooth/blob/main/code/PiHome_V1.13.0_SDK_V4.2.0/btsmart/src/main/java/com/jieli/btsmart/ui/music/device/FilesFragment.java

**Critical capability gate:** JieLi RCSP is a broader protocol/framework than the known working BG02 **FitPro Dial31** transport. These interfaces do not establish that BG02 exposes a compatible RCSP file service, advertises an online volume, or permits reading its wallpaper partition. The example file browser is primarily for storage/music, not explicitly BG02 images. `AE00` is an OTA-related GATT service; `4A02` and `7E40...004` are not proven RCSP file interfaces. No guessed vendor commands should be sent.

### Recommended decision order

1. **Source-only check:** identify the RCSP `ReadFileParam` format, capability gate, and device-side counterpart. Check whether a **BG02-compatible** firmware / SuperBand implementation advertises RCSP file browsing or wallpaper readback. If yes, this would be a direct native **Download from Badge** path; pursue this first.
2. **Source-only peer fallback:** obtain the 200patch02+ peer-sharing module, find BLE advertising and receiver contract. Only if the standard file-read path is absent, build a safe, isolated receiver.
3. **Hardware gate only after code proof:** connect, enumerate volumes (no deletions or OTA), and try retrieving one known harmless user image. Distinguish GATT reads from a true file-transfer protocol.

## November 10 source and catalog resolution: direct readback candidate

### Checked source and catalog facts

- [Source inventory CI](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42960677683) and [vendor RCSP file-handler CI](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42960880393) read official public JieLi GitLab project **1463**, `e_badge_707_sdk_200` `main`. Source files `rcsp_browser.c`, `file_trans_back.c`, and `file_transfer.c` are present. Source symbols include `file_trans_back_task`, `rcsp_file_trans_back_opt`, `fopen` and `fread`. The generic vendor framework implements a device-to-host file-return path; **BG02 firmware feature enablement remains unverified**.
- [Peer path and OTA check CI](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42961091959) searched targeted `SDK/apps/common/ui/lcd`, `SDK/apps/common/ui` (first 600 paths, cap reached), `SDK/apps/watch/board/br35/board_ac707n_demo`, and `SDK/apps/watch` for peer-sharing filenames. No matching paths were observed in the sampled public `main` tree. This is **not an exhaustive source-tree check**, nor is `main` guaranteed to contain the demo's **200patch04** files. The project has only a `main` branch and no public tags as of this inspection; the README links the demo's 200patch04 archive separately.
- One exact official SuperBand OTA **upgrade-catalog** query with `name=BG02`, `version=V35922` returned **no upgrade offered**. The endpoint answers *what upgrade is available FROM the supplied version*, not *where to download that version*. This does **not** demonstrate that the V35922 image is unavailable elsewhere, and it did not download or flash anything.

### New controlled Windows authentication diagnostic

The [ElectronicCats DG01-specific client](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/baji-ble/baji_ble/sysinfo_probe.py) has an `AE00`-only six-step handshake and target-info query without the E87 `FD00` bootstrap. Its source is MIT-licensed. Our new `tools/bg02_ae00_auth_probe.py` reuses that **pinned external `qix-ble` dependency** rather than duplicating a cryptographic algorithm. **This is an attempt to test BG02 compatibility, not a claim that BG02 uses the same key or policy.**

- Without `--connect`, it is purely offline; no Bleak or qix dependency is needed.
- With explicit `--connect`, it scans only for the exact `BG02` advertised name and confirms `AE00/AE01/AE02`. A worker-thread adapter attempts the related JieLi raw authentication exchange, strictly permitting only the three auth messages. If authentication succeeds, it sends one `GET_TARGET_INFO 0x03` request with the fixed mask and platform and returns **attribute names only** (not raw serial, auth key or MAC). Optional `--auth-only` stops after the handshake.
- Every **filesystem browse/read, file-transfer/delete, flash, OTA, raw-FitPro and unrelated RCSP opcode** is blocked by a transport-level allowlist. No retries; exceptions are reduced to diagnostic type and packet counts.
- [Offline CI run](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42961567725): **15/15 passed** (6 new guard tests plus 9 RCSP/parser/retired-command tests). **No real BG02 authentication was attempted.**

**Windows setup (verified workaround for a real Git filename-length failure).** The earlier one-line `uv run --with "qix-ble @ git+..."` **must not be used on Windows**: `uv` recursively initializes unrelated repository submodules, and the giant JieLi firmware SDK checkout fails with `Filename too long`. The authentication library itself does **not** require either submodule. Use a sparse, nonrecursive checkout followed by a local package install.

```powershell
# Download the pinned MIT-licensed library source, without ANY submodules.
cd D:\Claude\scratch
git clone --filter=blob:none --sparse --no-recurse-submodules https://github.com/ElectronicCats/jieli-ble-badge-research.git jieli-badge-src
cd .\jieli-badge-src
git checkout 1802a8860d87f02c4c8562721f49ee85f1031dce
git sparse-checkout set tools/qix-ble

# From your local research branch checkout.
cd D:\Claude\superband-bg02-research
git fetch origin
git switch research/bg02-peer-share-readback
git pull --ff-only
uv venv --python 3.12 .venv-bg02
uv pip install --native-tls --python ".\.venv-bg02\Scripts\python.exe" bleak "D:\Claude\scratch\jieli-badge-src\tools\qix-ble"

# Verify imports and perform NO BLE connection.
& .\.venv-bg02\Scripts\python.exe -c "from bleak import BleakClient; from qix_ble.auth import AuthSession; from qix_ble.sysinfo import get_target_info; print('Dependencies OK')"
& .\.venv-bg02\Scripts\python.exe .\tools\bg02_ae00_auth_probe.py

# After closing SuperBand and the browser manager, one opt-in hardware test:
& .\.venv-bg02\Scripts\python.exe .\tools\bg02_ae00_auth_probe.py --connect
```

If the `jieli-badge-src` destination already exists from a partial attempt, inspect it or remove just that unused clone before restarting; do not overwrite unrelated directories. This sequence keeps the pinned source version while avoiding `uv`'s recursive Git submodule initialization. `git config core.longpaths true` alone is not the preferred fix because the huge SDK checkout is unnecessary.

The external dependency is pinned to a concrete public commit (MIT), and the optional live command sends **at most the three authentication writes and one identity request**. This is still an *unverified* live compatibility experiment: a timeout or error should be treated as a STOP, not an invitation to retry or guess other opcodes. If auth succeeds but target information fails, the result narrows the next task to protocol initialization. If both succeed, the next task is to establish whether wallpaper storage is browsable, not to immediately display a Download button.

## Public JieLi SDK source code: server-side file readback exists

**Verified against JieLi GitLab project 1463 (`e_badge_707_sdk_200`) using a read-only source metadata API and limited source-symbol extraction.**

[CI source inventory](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42960677683) and [C/H source-symbol check](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42960880393) located:

- `SDK/apps/common/third_party_profile/jieli/rcsp/server/functions/browser/rcsp_browser.c` — includes `rcsp_browser_start`, `rcsp_browser_stop`, `rcsp_browser_dev_remap`, and a browse task.
- `SDK/apps/common/third_party_profile/jieli/rcsp/server/functions/file_transfer/file_trans_back.c` — includes `rcsp_file_trans_back_opt`, `file_trans_back_task`, `rcsp_browser_dev_remap`, `fopen`, and `fread`. The vendor SDK contains a **real device-to-host file-return code path**.
- `SDK/apps/common/third_party_profile/jieli/rcsp/server/functions/file_transfer/file_transfer.c` — contains separate file-download/receive functions and file handling, including `fopen`, `fread`, and `fwrite`.
- `SDK/apps/common/third_party_profile/jieli/rcsp/server/functions/device_info/rcsp_device_feature.c` — contains file-transfer mode capability metadata.

This source distinction matters: *the SDK's file-return command is implemented*, not merely named in Android SDK API docs. But existence in the **public generic SDK** is **not proof the BG02 V35922 image compiled it in**, enabled its handler, or mapped the user's wallpapers into an exposed RCSP filesystem.

**DG01 nuance:** ElectronicCats' [DG01-specific `baji-ble` probe](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/baji-ble/baji_ble/sysinfo_probe.py) invokes a six-step `AE01/AE02` authentication and `GET_TARGET_INFO (0x03)` **without the E87 FD00 bootstrap path**. The earlier BG02 service table lacking E87's `FD00` therefore **does not disprove direct AE00 authentication**; it only makes the full E87 Qix control sequence inapplicable. Neither implementation has been validated against BG02 firmware V35922.

**Implementation decision:** Do not build file-browser UI yet. First prove a BG02-compatible authenticated RCSP session, then determine whether `rcsp_browser_dev_remap` permits reading wallpaper storage. If the firmware doesn't expose this, follow the separate badge-to-badge wallpaper transport.

## Verified offline executable scan (November 10, 2026)

**Completed on GitHub Actions:** [one successful unpacked app.bin audit](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42954920377), with 6/6 firmware scanner tests passing.

The two committed archives were unpacked with `kagaimiq/jl-misctools`. Executables: **LJ733 V27550** `app.bin` **901,191 bytes** (SHA-256 `cc65774c7090767b4f16e84ec385b3c02e1718f4a7099ace43f51ff5f6112225`) and **LJ733B V34574** `app.bin` **973,060 bytes** (SHA-256 `d411db75de4d660289d199913f4a5aaad473166fb5afd17dd1f7eb101a8d9fd3`). Both show `storage/virfat_flash/C/`, `watch.sty`, `JL.sty`, `res_nor_dial`, `JLOTA` and `ble_ota` references. Neither yielded *plaintext* wallpaper-sharing, auth or RCSP file-browse symbols, which **does not rule out stripped binary handlers**.

The complete reproducible offsets, firmware identities, limitations and next decision are in [BG02 firmware executable scan report](BG02-FIRMWARE-EXECUTABLE-SCAN-2026-11-10.md). These older builds are **not exact V35922**. The next research gate is obtaining the correct firmware or the complete JieLi receiver module, not another unauthenticated BLE query.

## Offline compatibility audit — November 10 follow-up

Added `tools/bg02_firmware_evidence.py`: a Windows-compatible, standard-library-only, read-only scanner of ZIP members, UFWs and extracted binaries. It outputs SHA-256, member-relative offsets, and string hints for wallpaper sharing, wallpaper storage, RCSP file browsing, authentication, and BLE transport. No BLE access, flash commands or network access.

One command (from the project root, with the two existing archives):

```powershell
py -3 tools/bg02_firmware_evidence.py research/firmware/lj733_V27550.zip research/firmware/lj733b_V34574.zip --json-out "D:\Claude\scratch\bg02_firmware_evidence.json"
```

To inspect extracted firmware instead, pass `research/firmware/analysis` if previously unpacked.

**Critical limitation:** an `app.ufw` is a *packed firmware container*. Plaintext scanning its raw bytes can miss handlers buried in the unpacked `app.bin`. A missing keyword is **not** evidence that a capability is absent. This tool does not unpack UFW or disassemble code. Six offline test cases were committed but not executed during this research turn. We do not have BG02 V35922 `app.bin`; the older LJ733 archives cannot prove V35922 behavior.

### Comparable public AC707N implementation — not the same BG02

The [ElectronicCats AC707N E87/DG01 implementation](https://github.com/ElectronicCats/jieli-ble-badge-research) targets **360×360** E87/DG01, not our BG02 **240×240, firmware V35922**. It contains a six-step cryptographic AE01/AE02 handshake; an auth-gated RCSP target-info `0x03`; auth-gated browse `0x0C` of USB/SD0/SD1/FLASH; and small-file read `0x28`. Its source also notes DG01 browse attempts that returned zero entries because no browsable storage was mounted. Thus even successful RCSP auth would not imply wallpaper file access. **The E87/DG01 Qix control path additionally uses an FD00 GATT service; the owner's BG02 service discovery did not include FD00.** This rules out treating the entire Qix bootstrap/control workflow as a drop-in BG02 implementation, even though both expose AE00.

- [Authentication source](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/auth.py)
- [RCSP filesystem source](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/rcsp_session.py)
- [Peer-wallpaper demo](https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707N蓝牙互传图传demo/)

The peer-wallpaper demo uses its own wallpaper path/list management and says apps may require custom RCSP or BLE commands to add and delete wallpapers. **Generic media browsing and wallpaper retrieval must be proven independently**, not assumed from a functional authenticated session.

### Evidence gate for the next device experiment

1. Unpack BG02-compatible firmware (prefer exact V35922), then trace relevant authentication and wallpaper-sharing handlers; strings alone are not call-graph proof.
2. If protocol compatibility is established, prepare an isolated auth → identity `0x03` client and one bounded hardware test.
3. If generic storage browsing is unrelated to wallpaper storage, pivot to the receiver-side handshake in `wallpaper_sharing_main.c` rather than further RCSP guesses.

**No further live Bluetooth test requested right now.**

## Corrected RCSP opcode and observed hardware results (2026-11-10)

### Hardware results: both active attempts were silent

The owner ran the one-shot active diagnostic **twice**, each with an 8-second window, using `--probe-target-info`. Both connected, subscribed to `AE02`, and reported **one `AE01` transmitted event and zero `AE02` received events**. Both runs used the same output JSONL path, so the second run overwrote the first; the terminal output independently confirms both.

**Important correction:** the probe sent `FE DC BA C0 02 00 05 01 FF FF FF FF EF`, which the earlier code incorrectly described as `GET_TARGET_INFO`. In the JieLi family, `0x02` is **GET_TARGET_FEATURE_MAP**, whereas **`0x03` is GET_TARGET_INFO**. The parameter structure for the real `0x03` target-info query also includes a one-byte platform field, yielding a **six-byte** body rather than five.

Independent sources validating `0x03` mapping and the session precondition:
- https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/sysinfo.py
- https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/rcsp_session.py
- https://github.com/jumpingmushroom/e87_badge/blob/main/docs/protocol.md
- https://github.com/HackSucks/OpenWearOTA/blob/main/openwearota/drivers/jieli.py

**Interpretation:** the BLE stack accepted a write-without-response transaction; that is **not** confirmation that the BG02 firmware parsed or accepted it. No reply could mean an authentication requirement, wrong dialect/firmware handler, or unsupported command; the absence of an AE02 response cannot disprove filesystem access.

### The missing precondition: JieLi application authentication

In a **related AC707N badge** implementation (`ElectronicCats/jieli-ble-badge-research`), both `get_target_info` and `RcspSession` explicitly check an `_auth_done` flag before sending a request. The underlying implementation documents a **six-step cryptographic challenge–response exchange** on `AE01/AE02`, including raw frames that are *not* wrapped in `FE DC BA`. That source shows source-level filesystem readback tasks too, but we **cannot infer that BG02 V35922 uses the identical cipher, authentication state or file storage setup**.

Sources:
- https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/auth.py
- https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/bootstrap.py
- https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/tools/qix-ble/qix_ble/rcsp_session.py

### Code state after correction

- `tools/bg02_rcsp_protocol.py` now correctly labels `0x02` as `GET_TARGET_FEATURE_MAP` and `0x03` as `GET_TARGET_INFO`; its six-byte `0x03` request is an **offline fixture only**.
- `tools/bg02_rcsp_observe.py` is passive again. The old `--probe-target-info` switch is **retired** and terminates with a clear error **before connecting or writing**. The previous command shown in older PR comments should **NOT** be rerun.
- `tools/tests/test_bg02_rcsp_observe.py` checks protocol decoding, passive-only BLE behavior and early rejection of retired active mode. Actual tests were **not executed** in this follow-up; don't claim a new green hardware/CI receipt.

### Recommendation and next development gate

**STOP** blind probes, including a corrected unauthenticated `0x03`, RCSP browse `0x0C`, and file return `0x24`. Do not try the related E87 six-step auth against BG02 until there is compatibility evidence.

1. Compare source evidence for V35922 or a close LJ733 firmware against the public JieLi `AuthSession`/RCSP implementation. If BG02-specific evidence verifies the authentication path, port a single source-backed **auth + `0x03` target info** diagnostic.
2. If non-OTA RCSP cannot be verified, prioritize `wallpaper_sharing_main.c` and a receiving-peer GATT emulator rather than further AE00 writes.
3. Only after a valid authenticated RCSP response and accessible media storage are verified, add file listing and downloading. Keep media-delete/flash/OTA operations out of scope.

## BG02 V35922 hardware result — passive AE02 observer (2026-11-10)

The owner ran `tools/bg02_rcsp_observe.py --device BG02 --seconds 20` twice under Windows/Bleak (using `uv run --native-tls --with bleak`), navigating both **Send** and **Receive** modes.

**Observed:** Both connections and `AE02` notification subscriptions succeeded. **Zero notification fragments** were logged in both 20-second runs. No transfer started; no image was retrieved. Both commands pointed to the same JSONL path, so the second run overwrote the first (both independently printed 0 notifications).

**Precise interpretation:** No **unsolicited** `AE02` traffic was emitted to this connected central during those windows. This does **not** prove the stock BG02 lacks RCSP or file readback: RCSP typically emits responses after correctly framed, possibly authenticated, commands; the passive observer sends none. Further, connecting as a BLE central does **not** passively sniff another link's packets, and the active PC connection may preclude the badge from acting as the peer-sharing central/receiver. Do not use this negative result to rule out the `wallpaper_sharing_main.c` path.

**Action:** **Do not repeat passive AE02 or BLE scans**. Retire the passive observer as a useful capability probe. The next defensible work is source analysis to establish (a) whether V35922 routes non-OTA RCSP through `AE00` and exposes any filesystem, or (b) the receiver's precise advertising and GATT contract from the JieLi peer-sharing source. Only implement a bounded, **explicit** active read-only query after firmware/source evidence defines its frame, authentication and expected response. Do not guess `0x0C`/`0x24` writes or touch OTA/raw-flash endpoints.

## Concrete RCSP GATT and file-reading path (2026-11-10)

### Why AE00 warrants investigation

A direct reading of vendor BLE RCSP documentation identifies **AE00** as the RCSP service with **AE01** for writes and **AE02** for notifications. The same page describes **3802/4A02** as an Alipay profile when the Alipay feature is enabled. These descriptions are from a *different JieLi SDK/chip family*, not the exact BG02 V35922 GATT implementation, but they match the characteristic properties supplied by the owner.

Sources:
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/fw-AC79_AIoT_SDK/4-bluetooth/4.4-bt-extensions.html
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/fw-AC63_BT_SDK/9-third-party-integrations/9.1-jl-rcsp.html

The latter SDK documents an RCSP framing pattern **FE DC BA ... EF**, an authorization phase, and these *standard RCSP* opcodes:

| RCSP opcode | Vendor symbol | Function in SDK | BG02 support |
|---|---|---|---|
| 0x02 | JL_OPCODE_GET_TARGET_FEATURE_MAP | Query feature map | Unknown |
| 0x03 | JL_OPCODE_GET_TARGET_FEATURE | Query target features | Unknown |
| 0x07 | JL_OPCODE_SYS_INFO_GET | Read system information | Unknown |
| 0x0C | JL_OPCODE_FILE_BROWSE_REQUEST_START | Start browsing a directory | Unknown |
| 0x0D | JL_OPCODE_FILE_BROWSE_REQUEST_STOP | Stop browsing | Unknown |
| 0x24 | JL_OPCODE_ONE_FILE_TRANS_BACK | Transfer one file back | Unknown |

**These are opcode references for *other JieLi firmware implementations*, not wire packets tested on BG02.** Valid RCSP requires correct framing, authentication, device support, and real file handles/names. Do not directly transmit single-byte opcodes to AE01, or auto-test 0x0C/0x24. The OTA feature may coexist on AE00; malformed writes could trigger undesired device behavior.

### Direct readback has a public sample implementation

The official JieLi Android Health demo has:
- `FileBrowseManager.getOnlineDev()` for enumerating online storage.
- `FileManagerDemo` with `GetFileByClusterTask.Param(devHandle, 0, cluster, localOutputPath)`.
- `GetFileByNameTask.Param(devHandle, name, localOutputPath, unicode)`.
- `WatchTestTool` source `ReadFileByNameTask.java` and `ReadFileByClusterTask.java` showing progress, cancellation, and saving to phone paths.

Vendor code:
- https://github.com/Jieli-Tech/Android-JL_Health/blob/main/code/app/HealthAide_V1.1.0_SDK_V1.14.0/app/src/test/java/com/jieli/healthaide/demos/FileManagerDemo.java
- https://github.com/Jieli-Tech/Android-JL_Health/blob/main/code/tool/WatchTestTool_V0.9.0_SDK_V1.14.0/app/src/main/java/com/jieli/watchtesttool/tool/test/filetask/ReadFileByNameTask.java
- https://github.com/Jieli-Tech/Android-JL_Health/blob/main/code/tool/WatchTestTool_V0.9.0_SDK_V1.14.0/app/src/main/java/com/jieli/watchtesttool/tool/test/filetask/ReadFileByClusterTask.java

This is stronger than inference from `IFileOp` alone; it is a working *SDK sample flow* on supported JieLi devices. **However, those sample files target general flash/SD storage and do not show BG02 V35922 or its wallpaper files being exposed.** Also, JieLi's RCSP authentication may prevent usable responses even if AE00 is present.

### Implemented: passive BG02 AE02 observation tool

`tools/bg02_rcsp_observe.py` is a standalone Bleak utility which **subscribes** to AE02 notifications for a single short window. Optional `--also-uart` subscribes to the existing FitPro UART notification characteristic. It sends **no RCSP, file-management, FitPro, or OTA command**. As with any BLE notification subscription, it does enable the standard GATT CCCD descriptor. Connection and notification subscription might change peer-sharing behavior; this is not a transparent over-the-air sniffer.

```powershell
# From the BG02 project root; disconnect SuperBand and the browser manager first.
uv run --with bleak python tools/bg02_rcsp_observe.py --device BG02 --seconds 20 --output "D:\Claude\scratch\bg02_rcsp_observe.jsonl"

# Offline analysis after the observation:
py -3 tools/bg02_rcsp_observe.py --inspect "D:\Claude\scratch\bg02_rcsp_observe.jsonl"
```

The JSONL records only relative times, the notification characteristic and the raw payload hex; it intentionally omits MAC addresses, serial and model metadata. Payloads can nonetheless contain private data: **do not commit or publish unreviewed output**. This tool has **not** been run against the user's BG02.

**Interpretation:** An `FE DC BA` magic prefix on AE02 would be evidence *consistent with* JieLi RCSP traffic. No notifications, or no visible prefix, would **not** prove absence of the protocol, especially if the badge expects authentication or a query before replying. The tool does **not** establish a file library or download function.

### Implementation gate

1. Determine whether BG02's AE00 channel provides **non-OTA RCSP** and authenticates to a compatible host. Do not send guessed commands.
2. Establish whether the accessible RCSP file browser includes the **wallpaper storage** (not just general removable music storage).
3. Only then implement listing and `GetFileByNameTask`/`GetFileByClusterTask`-equivalent download.
4. If unavailable, return to the peer-sharing receiver implementation.

## Specific code locations to inspect next (read-only)

1. Prioritize the **documented RCSP file-read APIs** and whether BG02 advertises that capability (source review, no speculative wire commands). In parallel, obtain the relevant **peer-sharing demo SDK source**, not just vanilla `e_badge_707_sdk_200`. Search these exact symbols:
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
