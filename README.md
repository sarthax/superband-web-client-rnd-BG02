# BG02 Picture Manager

A browser-based picture uploader for the **BG02 / LJ733 electronic badge** and a research-compatible manager for other SuperBand/Baji/FitPro badges.

**Everyday workflow:** Connect badge → Choose a picture → Crop/zoom → Upload.

This is a **static browser application**, not a picture-storage web server. The image is processed in your browser and sent directly to the badge with Web Bluetooth; it is not uploaded to a website or cloud service.

## Use it

- Open the [fork's GitHub Pages site](https://sarthax.github.io/superband-web-client-rnd-BG02/) **after the picture branch has been deployed**, or run locally (see below).
- Use **Chrome or Edge on desktop** with Bluetooth enabled. Web Bluetooth generally requires HTTPS or localhost; Firefox does not provide the required Web Bluetooth API.
- Click **Connect badge**, choose a JPG/PNG/WebP, drag inside the circular crop, adjust Zoom, and click **Upload picture**.
- After the transfer is acknowledged, **check the badge display**. Bluetooth success does not prove on-device rendering.
- Advanced users can still import pre-encoded **.ru50** pictures for BG02.

**BG02 V35922:** Fixed 240×240 output, browser ETC2 RGB8 encoding inside the RU50 container (29,904 bytes), sent using the existing FitPro Dial31 transfer. The invalid direct RGB565 route is blocked for confirmed BG02 devices. For other devices the existing Baji JPEG or generic FitPro RGB565 paths remain available. The controls and format adapt to the *connected* badge.

The browser crop/encoder has been implemented and the owner has reported working image uploads. **Before the final public release, verify that the merged/released commit is the one that produced the good on-device picture.** Earlier PR descriptions still label their own snapshots as hardware-unverified.

### What is *not* supported on BG02

- Downloading, listing, or deleting pictures already stored on the badge.
- Badge-to-badge sharing from the web page.
- Automatic GIF/AVI upload from the browser (experimental external conversion tools are not part of this UI).
- Firmware flashing as part of picture uploads. **Do not use an unrelated BJ-1/DG01 OTA package on BG02.**

The extensive Bluetooth/firmware experiments remain separate and are **not needed** for ordinary pictures.

## Run locally (Windows / macOS / Linux)

Requires [Bun](https://bun.sh/) and a Chromium-family browser.

```bash
cd src
bun install --frozen-lockfile
bun run dev
# Open http://localhost:8787
```

Focused regression and production build:

```bash
cd src
node --test tests/ru50.test.mjs tests/device-profile.test.mjs tests/browser-etc2.test.mjs
bun run build
```

No Python, `etcpak`, phone app, or local firmware SDK is required for the **browser photo workflow**.

## Day-to-day UI vs research

| View | What belongs there |
|---|---|
| **Pictures** | Connect/disconnect, active badge, choose image, crop and zoom, upload, persistent progress/error messages |
| **Optional device details** | Technical identity fields and re-pair controls |
| **Advanced** | Activity log, GATT/OTA information, protocol probes and research controls; **not needed to upload** |

For BG02 the unrelated Baji media library and BJ-1/DG01 OTA presets are hidden or disabled. Other supported device families retain their original behavior.

## Code and documentation

| Location | Content |
|---|---|
| [`src/`](src/) | Browser UI, image conversion, Web Bluetooth and static production build |
| [`src/js/circle-crop.js`](src/js/circle-crop.js) | Drag, touch/pinch, zoom, and circular output |
| [`src/js/ru50.js`](src/js/ru50.js), [`src/js/etc2.js`](src/js/etc2.js) | RU50 wrapper, CRC16 and browser ETC2 encoding |
| [`src/js/device-profile.js`](src/js/device-profile.js) | BG02 vs Baji vs generic FitPro behavior |
| [BG02 browser crop and codec](docs/BG02-BROWSER-CROP.md) | Original picture workflow and acceptance checks |
| [Device-aware UI](docs/DEVICE-AWARE-UI.md) | Device capability boundaries and precautions |
| [RU50 research](docs/BG02-RU50-EXPERIMENT.md) | Historical manual encoder/import fallback |
| [Protocol notes](docs/README.md) | GATT, FitPro, Baji, OTA, security and reverse-engineering references |
| [Research and firmware tools](tools/README.md) | Optional standalone tooling; **not required for picture uploads** |

The **picture upload changes are stacked** as draft PRs [#1](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/1), [#2](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/2), and [#3](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/3). Finish and review the [picture cleanup PR](https://github.com/sarthax/superband-web-client-rnd-BG02/pulls) on top of #3 before merging in order. **Do not merge or deploy unreviewed local overrides.**

The separate [BG02 peer sharing / readback research PR #4](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/4) is intentionally not part of the picture release.

## Deployment

The static site is published by [GitHub Pages Actions](.github/workflows/pages.yml). The workflow calculates the repository's base path. A push to `main` or an explicit manual workflow run can deploy the chosen branch; **manual deployment replaces the current Pages site**, so test the merged commit before publishing it. The single [Validate workflow](.github/workflows/validate.yml) runs the three focused image tests and builds the web client.

## Attribution and safety

Fork of [T-REX-XP/superband-web-client-rnd](https://github.com/T-REX-XP/superband-web-client-rnd), derived from unofficial research into SuperBand Android 2.1.25 (`com.legend.smartwatch.electronicbadge.android`). Additional experimental media-format references include [arqueomendez/ebadge](https://github.com/arqueomendez/ebadge). Not affiliated with the badge vendor or app publisher.

Use only with devices and firmware you control. Advanced OTA flashing and protocol tools can disconnect or permanently damage a device; picture uploads **do not require** them.
