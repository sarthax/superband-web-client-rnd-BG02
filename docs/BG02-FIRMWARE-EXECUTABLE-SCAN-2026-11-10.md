# Offline LJ733 executable evidence — November 10, 2026

Status: **COMPLETED OFFLINE SCAN — BG02 V35922 READBACK STILL UNVERIFIED**.

## Reproducibility

- One bounded GitHub Actions audit on PR #4 research branch; successful executable-level run:
  https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/42954920377
- Commit audited: `5e027932ba8e140559687c0aaab5981995503466`.
- Pure Python `tools/bg02_firmware_evidence.py`; **6/6 tests PASS**.
- Archives are already committed under `research/firmware/`; extracted by `kagaimiq/jl-misctools` `fwunpack_newfw.py` with `pyyaml` and `crcmod`.
- All scan operations were hosted and offline with respect to the badge: **no Bluetooth connection, file write to badge, firmware flashing, OTA command, or application protocol writes**.

## Verified extracted executable results

| Input ZIP | `app.ufw` bytes | `app.bin` bytes | Extracted `app.bin` SHA-256 | SDK banner string |
|---|---:|---:|---|---|
| `lj733_V27550.zip` | 2,917,472 | 901,191 | `cc65774c7090767b4f16e84ec385b3c02e1718f4a7099ace43f51ff5f6112225` | `AC707N_V0.0.1-@20250115-$912e0a86` |
| `lj733b_V34574.zip` | 3,089,952 | 973,060 | `d411db75de4d660289d199913f4a5aaad473166fb5afd17dd1f7eb101a8d9fd3` | `AC707N_V1.0.0-@20250403-$14f6057c` |

### Source-backed candidate string offsets (member-relative, hexadecimal)

| String | V27550 `app.bin` | V34574 `app.bin` |
|---|---|---|
| `storage/res_fs_dev/C/watch.sty` | `0xC8D4A` | `0xD7C90` |
| `storage/virfat_flash/C/` | `0xCD170` | `0xE26EC` |
| `storage/virfat_flash/C/JL/JL.sty` | `0xCD3CD` | `0xE294D` |
| `res_nor_dial` | `0xCC923` | `0xE1E7F` |
| `Zble_ota.bin` | `0xA563B` | `0xB42DB` |
| `JLOTA` | `0xC87CF` | `0xD7727` |

The `virfat_flash` strings identify virtual-FAT-flash resources in the *older firmware*. They do **not** mean a user-media directory is visible over RCSP. `watch.sty` and `JL.sty` may be static UI resources; no file listing or download was observed.

### What did not appear as plaintext

The scanner found no matches in these extracted `app.bin` files for its *exact* wallpaper-sharing anchors (`wallpaper_adv`, `wallpaper_sharing`, `jl_wallpaper_sharing`), RCSP filesystem strings (`file_browse`, `get_file_by_`, `file_transfer`, `rcsp_fs`) or auth anchors (`rcsp_auth`, `jl_auth`, `getEncryptedAuthData`, `auth_key`). Nor did the scan report the `bgp_wa` string that appeared in an earlier **BJ-1 V32286** snapshot; this illustrates variation between firmware builds.

**Negative-string caution:** these are stripped binary executables. Absence of developer symbol names is not evidence that bytecode handlers, file IO, or peer sharing do not exist. We performed no instruction disassembly or cross-reference analysis, and the two archives are not from the live **BG02 V35922, LJ733_MB_V1.5** badge. Do not infer feature availability/absence from them.

## Practical decision from this audit

1. **Stop attempting isolated RCSP commands.** The only active tests so far were two earlier unauthenticated requests that mistakenly used `0x02` and produced no `AE02` response. That option has been retired.
2. **Prioritize locating a V35922-matched `app.ufw` / `app.bin`** through an official SuperBand OTA catalog entry or other authorized local firmware copy. Record provenance and SHA-256. Do not flash anything.
3. If the exact image can be obtained, inspect the `AE00` dispatcher/auth state and peer `Share Picture`/`Receive Picture` path. A concrete function-level match would justify one bounded authenticated identity test or peripheral emulation.
4. If no exact image is obtainable, a compatible **second BG02** is the shortest empirical route to observe a successful share; otherwise receiver emulation requires obtaining the JieLi peer-demo transfer module. Do not claim stock wallpaper readback from generic RCSP file-browse documentation.

This report resolves the two committed firmware archives as **inconclusive but now genuinely inspected**. It does not implement download functionality.
