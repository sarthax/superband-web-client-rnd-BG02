# LJ733 family firmware component comparison — November 11, 2026

**Completed: [corrected GitHub Actions job PASS](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/43132630067).** All analysis was offline with respect to badges; no BLE, flash writes or modified firmware. None of the four input images came from the owner's **BG02 LJ733_MB_V1.5, V35922**.

## Inputs and verified application bytes

| Image | Extracted app.bin bytes | SDK build |
|---|---:|---|
| DG01 V32399, LJ733 V1.2 | 979,778 | AC707N V1.0.0, April 2025 |
| BJ-1 V32286, LJ733 V1.2 | 979,721 | AC707N V1.0.0, April 2025 |
| Older LJ733 V27550 | 901,191 | AC707N V0.0.1, January 2025 |
| HYX V34574, LJ733 V1.1 | 973,060 | AC707N V1.0.0, April 2025 |

Extracted with [jl-misctools](https://github.com/kagaimiq/jl-misctools), commit 0a5b12db0ef38f3042acffbe2452730a37fd2405. The two known vendor CDN DG01/BJ-1 packages were temporarily downloaded and unpacked in CI, not committed. Results: [comparator](../tools/bg02_compare_firmware.py), [workflow](../.github/workflows/bg02-firmware-component-compare.yml), and the metadata-only Actions artifact **bg02-firmware-component-metadata**.

**Identical SHA-256 extracted content across all four:**
- top/uboot.boot and top/isd_config.ini
- files/cfg_tool.bin, files/config.dat and files/stream.bin
- files/ui_upgrade-extracted/upgrade.json, upgrade.res and upgrade.str

**Identical DG01/BJ-1 only:** files/p11_code.bin (17,980 bytes, sha256 426a5a46cf4470da05cd6cda118594735f46f1c2b1f4136a01fa3a1a5a891eb3).

**Different across variants:** All four main app.bin hashes; their OTA upgrade.sty (138 bytes each, different bytes); game sound effect files; and some low-power P11 versions. DG01/BJ-1 both contain game_ballon.wtg and game_muyv.wtg, but the same-named audio files have different hashes. HYX offers find_tone.wtg and key_tone.wtg instead. **WTG assets are sounds, not the executable code of games.** Exposed upgrade.res/str/sty concern OTA UI, not necessarily the main menu.

## Binary overlap — exact blocks, not code-function equivalence

The initial comparator sampled target-file offsets every 256 bytes, which incorrectly reported zero 1-KiB matches for DG01/BJ-1. Corrected analysis searches **all possible destination byte offsets**, excluding low-diversity padding. Use the corrected PASS run 43132630067, not the initial trial.

| Pair / direction | Exact high-information 1,024-byte source blocks found anywhere in target | Printable ASCII string-set Jaccard |
|---|---:|---:|
| DG01 → BJ-1 | **104 / 954 (10.90%)** | **96.81%** |
| BJ-1 → DG01 | 106 / 954 (11.11%) | 96.81% |
| DG01 → HYX | 50 / 954 (5.24%) | 76.03% |
| DG01 → older V27550 | 36 / 954 (3.77%) | 66.44% |
| Older V27550 → HYX | 44 / 877 (5.02%) | 74.06% |

Several exact DG01/BJ-1 blocks are shifted by **24 bytes** between binaries, demonstrating small relocations. **Do not read 96.81% shared strings as 96.81% of code identical, or 10.90% byte-block matches as 89.10% function differences.** This is neither a function-level comparison nor a proof of cross-board firmware compatibility.

## Relevance to modifying text, artwork and games

Common JieLi UI-format references appear in app.bin strings: watch.sty, JL.sty, storage/nor_ui, res_nor_dial, JPEG decode, and other UI/font paths. The vendor likely uses shared UI authoring formats, but the actual main menu/game resource partition is **not fully recovered here**. An extracted OTA upgrade.sty is not enough to patch the badge's games or menus. A matching BG02 V35922 UFW image and a proven recovery method remain prerequisites.

## Independent BG02 protocol reference

[arqueomendez/ebadge](https://github.com/arqueomendez/ebadge) is a Python/Bleak client for **FitPro 7E40 photo upload**, with 0xCD/0xDC framing, 240×240 RU50/ETC2, DIS and dimensions. Its author tested **LJ733_MB_V1.1 with V35509**, NOT the owner's **LJ733_MB_V1.5 with V35922**. It reports that raw BLE upload data can be acknowledged even if the image finishing handshake never succeeds. It does **not** implement badge-to-badge picture sharing, on-badge file readback, JieLi AE00 RCSP file browsing or OTA flashing.

An additional bounded [official SuperBand OTA catalog run](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/43133209595) queried this newly observed V35509 firmware and returned **no update offered**. It is a real earlier firmware from a related board, but **not a confirmed V35922 predecessor**.

## Decision

Do **not** cross-flash different LJ733 variants. Offline component and resource reuse is plausible; stock BG02 V35922 firmware modification, OTA repack/recovery, main UI resource extraction and game editing remain unproven. Continue only after obtaining an exact BG02 image or valid board-specific SDK/resources.
