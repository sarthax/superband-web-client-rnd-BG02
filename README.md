# BG02 Picture & Video Manager

A browser-based editor and uploader for **BG02 / LJ733_MB_V1.5 electronic badges**, with experimental compatibility tooling for other FitPro/Baji badges.

**No cloud media server.** Pictures and GIF/video conversions run locally in Chrome/Edge and are uploaded directly over Web Bluetooth when you explicitly click Upload. The manager does not change the badge picture automatically.

## Start

- [Open the hosted Badge Manager](https://sarthax.github.io/superband-web-client-rnd-BG02/) (GitHub Pages, deployed from `main`) or run locally.
- Use Chrome or Edge with Bluetooth enabled; Web Bluetooth requires localhost or HTTPS.
- Connect BG02, choose a source image, adjust the circular crop and zoom, click **Optimize picture**, review the output and click **Upload picture**.

### BG02 still pictures — validated on V35922/LJ733_MB_V1.5

| Codec | Status | Notes |
| --- | --- | --- |
| **JPEG 4:4:4** | **Preferred** on confirmed BG02 V1.5 with dial algorithm 4 | User confirmed successful display, >53% byte savings on one image and improved text edges vs RU50. Actual file size depends on picture. |
| RU50 / ETC2 | Working fallback | Fixed 29,904 B at 240×240, ~32 KiB estimated storage allocation. |

The editor previews **source**, **decoded actual RU50**, and **decoded actual JPEG**, shows exact encoded bytes and a preliminary 8 KiB-rounded allocation estimate, and offers a quality slider 35–90. **Optimize picture** finds the highest tested JPEG quality fitting the allocation block at the initial 80% quality. Smaller/larger-block controls remain available. A confirmed BG02 V1.5 starts with JPEG; incomplete identities use RU50.

All output is 240×240 on BG02. Upload requires a connected, exact supported device identity and an explicit user action. JPEG uploads query free storage before transmission and validate the encoded file. The measured 8 KiB allocation increment is empirical, not a proven filesystem specification.

### Video and animated GIF

The **Video & GIF** tab accepts common browser-playable videos and animated GIFs, trims a segment, supports selecting GIF frames, shared/per-frame crops, compression and output comparison, and creates **240×240 Motion JPEG AVI**. You can download the encoded AVI before uploading.

The original SuperBand capture was 3 fps for five seconds. The owner separately reported successful 1 fps playback on BG02; longer lengths and 2/0.5 fps remain experimental. Output has no audio; AVI size and storage allocation are measured before upload.

For clips capped at five seconds, **Optimize AVI** measures actual Low/Medium/High JPEG outputs and can optionally compare 1fps and 3fps at an 8 KiB allocation target. It keeps the selected frame rate when possible and previews the actual chosen AVI before manual upload. See [AVI optimization details](docs/BG02-VIDEO-SPACE-OPTIMIZER.md).

### Portable local editing projects

Both picture and video/GIF editors can **Save project** and **Open project**.
The project ZIP bundles the original source and crop/trim/quality/frame settings
so editing can resume on another machine. Opening a project never uploads to
the badge; conversion and comparison must be repeated before sending.
Prepared JPEG/RU50 bytes can also be downloaded after review.

Following a successful picture upload, the manager displays the observed
before/after BG02 free-space delta (when available) alongside its estimated
8 KiB-rounded allocation. This is **not** a file list or full storage map.

See [local project details](docs/BG02-LOCAL-PROJECTS.md).

### Media diagnostics — read-only

The BG02 section can query FitPro **`0x20/2`** (dial info) and **`0x20/4`** (free storage), compare repeated storage readings, export sanitized diagnostics, and check whether **AE00/AE01/AE02** is present. This **does not list stored media files**. The legacy Baji file listing/deletion implementation is explicitly not available on BG02.

On V35922, AE00/AE01/AE02 are present, but an opt-in RCSP target-info `0x03` read timed out without a matching reply. Further authenticated RCSP/file-list research is on a separate [draft PR #12](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/12) and local-agent workflow. Do not use Baji delete commands or guessed media opcodes on BG02.

### Firmware research is offline-only

The **Advanced** tab supports GATT probing, OTA catalogue lookups, download and offline inspection of manufacturer firmware packages. **Browser firmware flashing is disabled**: no exact compatible BG02 V1.5 firmware package or authenticated RCSP updater has been qualified. BJ-1/DG01 LJ733 V1.2 packages are **not interchangeable** with BG02 V1.5.

See [BG02 V35922 OTA acquisition handoff](docs/BG02-V35922-OTA-FIRMWARE-ACQUISITION-HANDOFF.md) in draft #12 and [OTA protocol research](docs/protocol/ota-firmware.md). The earlier standalone experimental flashing helper is not a validated recovery method.

## Local development

Requires Bun, Node for tests, and Chrome/Edge.

```bash
cd src
bun install --frozen-lockfile
bun run dev
# http://localhost:8787
```

Production build:

```bash
cd src
bun run build
```

The GitHub Actions **Validate** workflow runs the repository's codec, device profile, media and safety tests as a single pass, then builds the site. **Pages** deploys to GitHub Pages on a `main` push.

## Code and research

- `src/js/app.js` — picture editing workflow and badge-aware actions
- `src/js/circle-crop.js`, `picture-comparison.js`, `jpeg-allocation.js` — framing, RU50/JPEG preview and quality/space selection
- `src/js/video-ui.js`, `video-avi.js` — video/GIF editor and MJPEG output
- `src/js/client.js`, `fitpro.js` — FitPro/Dial31 transport and telemetry
- `src/js/bg02-library-ui.js`, `bg02-media-capabilities.js` — read-only media feasibility
- `src/js/ota-safety.js` — fail-closed browser OTA gate
- [Research documentation](docs/README.md), [protocol notes](docs/protocol/), [local tools](tools/README.md)
- [Research source](https://github.com/T-REX-XP/superband-web-client-rnd)

## Merge policy

Feature work is reviewed in PRs and merged by the repository owner. Earlier BG02 UI/codec/media PRs **#1–#3 and #5–#11** are merged into `main`. **#4** (peer-sharing) and **#12** (read-only RCSP research) remain separate research branches. Nothing in the everyday picture/video workflow requires those research features to succeed.
