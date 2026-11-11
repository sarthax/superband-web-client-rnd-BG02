# Badge-aware manager UI (BG02 V35922 and other badges)

> **Historical PR #2 snapshot.** PR #3 added automatic browser JPG/PNG/WebP → ETC2/RU50 conversion and a circular crop editor. The BG02 picture manager now accepts ordinary photos **and** pre-encoded `.ru50`. See [current browser workflow](BG02-BROWSER-CROP.md) and [release checklist](BG02-PICTURE-RELEASE-CHECKLIST.md) for the current implementation.


This change keeps the original Baji/FitPro transport and encoding paths but
selects the user-facing image configuration based on the connected device.

| Device | Size | Accepted image | Interface |
|---|---|---|---|
| BG02 / LJ733 (confirmed) | 240×240 fixed | JPG/PNG/WebP via browser crop or pre-encoded RU50/ETC2 (.ru50) | Hide Baji media library, unsupported role/allocation options; disable BJ/DG OTA presets |
| Baji | reported size if available, otherwise 360×360 | JPEG 4:4:4 | Show media library and role/media options |
| Generic FitPro (BJ-1/DG01 etc.) | reported size if available, otherwise 360×360 | RGB565, or JPEG if algorithm 4 | Hide Baji-only controls |
| Unknown / disconnected | 360×360 placeholder | no upload without connection | Neutral pre-connect labels |

## Important: JPG/PNG on BG02

The previous web UI accepted JPEG/PNG, decoded it in the browser and
re-encoded it as **RGB565** even after the user manually set 240×240.
BG02 V35922 acknowledges that transfer but displays black.

PR #2 prevented the invalid RGB565 transfer. **PR #3 adds browser ETC2/RU50 conversion**, so ordinary photos are now the normal BG02 workflow. The original `tools/encode_bg02_ru50.py` remains an optional manual encoder for troubleshooting and importing pre-encoded `.ru50` files.

Do not describe JPG as supported on BG02 until an offline-vs-browser
ETC2 encoder comparison and hardware test confirms it.

## Interaction expectations

- After BG02 connects (name BG02 or hardware LJ733), both dimension
  controls become 240×240 and disabled.
- Selecting JPG/PNG/WebP on BG02 opens a 240×240 circular crop; conversion to RU50/ETC2 happens at upload time. No BG02 RGB565 data are transmitted.
- Selecting `.ru50` validates the header/CRCs and enables the original encoded-file upload fallback.
- After switching to a different badge, size, format hints, picker filter,
  relevant media controls, and prepared image are refreshed.
- Generic FitPro retains the original RGB565 path and editable dimensions.
- Baji or algorithm-4 devices retain JPEG 4:4:4.
- BG02 never exposes unrelated BJ-1/DG01 OTA preset flash actions; the
  Advanced tab continues to provide diagnostics.
- The original SuperBand project remains credited in the UI.

## Focused checks

From `src/`:

```bash
node --test tests/device-profile.test.mjs tests/ru50.test.mjs
bun install --frozen-lockfile
bun run build
bun run dev
```

In Chrome/Edge at http://localhost:8787, test BG02 connection and a `.ru50`
upload. Then switch to a non-BG02 badge if one is available and verify the
format control state. No firmware OTA test is required.

**GitHub branch warning:** this UI cleanup branch is based on the last
published `feature/bg02-ru50-encoding` commit. If additional working
converter changes exist only in a local worktree, preserve and reconcile
them before merging. Do not blindly overwrite those changes.
