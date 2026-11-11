# BG02 V35922 — official OTA catalog acquisition gate

**Status (2026-11-11): No matching BG02 V35922 OTA image obtained.** This is
a read-only metadata inquiry, not an OTA installation test. Target hardware:
**BG02 / LJ733_MB_V1.5 / firmware V35922**.

## What was run

One bounded GitHub-hosted audit using the previously recovered SuperBand
2.1.25 catalog API. Its [successful execution](https://github.com/sarthax/superband-web-client-rnd-BG02/actions/runs/43121296993)
called `tools/bg02_catalog_audit.py` to invoke the existing
`tools/probe-ota.mjs` against eight **already-documented version keys**.
No guessing or brute-forcing numeric versions. No BLE connection, writes,
firmware flashing, download, or archives uploaded.

The app-derived API is:

- `GET https://tomato.gulaike.com/api/v1/config/app`
- Query: `name=BG02&type=1&version=<reported-current-version>`
- SuperBand app headers are implemented in `tools/probe-ota.mjs`.
- A `data.app_down_url` returned by the server is an **upgrade target**,
  not proof of board compatibility; the field named `force` controls
  *mandatory update behavior in the app*, not forcing a file download.

The single audit intentionally publishes target **filenames**, not the token,
entire vendor response, raw URLs or hardware identifiers.

## Results — actual current catalog response

| Input `version` | Server entry | Firmware target and branch |
|---|---|---|
| `V35922` | **no offer** | No BG02 V35922 or later image URL |
| `V34574` | **no offer** | Target version of a different LJ733B cut |
| `V34576` | **no offer** | Target version of a different LJ733B cut |
| `V34250` | upgrade | `V34574_A05271020_LJ733_V1.1_HYX004_HYX_ZTFITPRO.zip` |
| `V32449` | upgrade | `V34576_A05251756_LJ733_V1.1_HYX004_HYX_ZTFITPRO.zip` |
| `V32294` | upgrade | `V32399_A12172156_LJ733_V1.2_YJ435_DG01_SUPERBAND.zip` |
| `V32172` | upgrade | `V32286_A12091701_LJ733_V1.2_ZX400_BJ-1_SUPERBAND.zip` |
| `V27423` | upgrade | `V27550.zip` (generic LJ733; hardware identity unverified) |

**Zero returned URLs identify an exact BG02 V1.5 or V35922 target.** Some
entries use product `LJ733`, but their firmware filenames identify different
OEM/hardware cuts. A public catalog response can be downloaded and unpacked
for study; **it is not permission to flash across model variants**.

## What we cannot conclude

- A no-offer response for `V35922` means the server does not currently
  propose an *upgrade from* V35922. It **does not** mean a V35922 ZIP never
  existed or cannot be retrieved by the proper predecessor key.
- We have **not determined the prior shipping firmware version** of
  BG02 / `LJ733_MB_V1.5`. Known LJ733 V1.1/V1.2 version keys are **not**
  reliable candidate predecessors for V1.5.
- The app APK contains an OTA client but **no stock badge app.ufw**.
- Authenticated AE00 traffic and a verified OTA installer path are **different
  proof steps**. We have not demonstrated a recoverable flash or modified
  firmware installation on this badge.
- Phone bugreports from the owner show **V35922** but no app-supplied
  `app_down_url` for BG02 in the captured period. Other `v35...` text
  in those reports includes unrelated Android app version codes and must
  not be mistaken for BG02 firmware predecessors.

## Next useful acquisition paths (no blind flashing)

1. Obtain an **original BG02 V1.5** older firmware version string (another
   physical unit's DIS firmware revision `0x2A26` or an OEM release note).
   Query that *exact* version with `bun tools/probe-ota.mjs --name BG02
   --version Vxxxxx` and inspect returned target name.
2. Ask the retailer or OEM for the **official BG02 / LJ733_MB_V1.5 / V35922
   app.ufw upgrade ZIP** or **its exact previous-version catalog key**. A
   screenshot of the device's update screen or exact SKU/board tag helps.
3. If a matching archive is located, download for **offline** inspection,
   record URL provenance and ZIP/UFW SHA256, and use
   `tools/bg02_firmware_evidence.py` and JieLi unpacking tools. Inspect
   UFW chip/board, OEM bootloader, flash geometry, resources, game/UI data
   and checksum before considering any modification.
4. Require a confirmed recovery/restore procedure before **ever** attempting
   a modified OTA. Do **not** install DG01/BJ-1/HYX packages on this BG02.

**Deliberate stopping rule:** no mass numeric-version scans or invented CDN
filenames. There is no justified server-side way to `force download V35922`
without a real matching catalog key or URL.

## Re-run (research only)

From the repo root, with Bun and Python 3 available:

```powershell
python tools/bg02_catalog_audit.py
```

This checks only the eight hardcoded, documented source/target versions
and prints sanitized metadata. For a newly **observed** real predecessor
version, use the existing `bun tools/probe-ota.mjs` command directly.

The image uploader and picture-manager cleanup (PRs #1/#2/#3/#5) are
unaffected. No release merges, firmware modifications or flashing occurred.
