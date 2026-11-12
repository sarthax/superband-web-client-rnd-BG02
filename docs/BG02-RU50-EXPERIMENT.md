# BG02 V35922 — experimental RU50 upload (hardware-test branch)

Target: BG02 / LJ733_MB_V1.5 / firmware V35922 / 240x240 display.

## Why this branch exists

The original browser manager sends 240x240 RGB565 (115200 image bytes)
wrapped by the FitPro dial31 file-length prefix (115204 bytes). The badge
acknowledges the transfer, but its display is black. Stock SuperBand works.

The vendor-derived `arqueomendez/ebadge` project provides an RU50 container
with ETC2 RGB8 data and two CRC16 fields. A 240x240 image becomes
28800 compressed bytes + 1104 header bytes = **29904 bytes**. This branch
lets the browser **import a pre-encoded .ru50 file**, validate its header
and CRCs, and send it using the already working dial31 ACK-based transport.

**Experimental, not yet hardware-verified:** We do not know if V35922 accepts
RU50 inside the existing dial31 custom-background path, or whether additional
type/flag/start-packet changes are required. Successful ACKs do not confirm
that the display decoded the image. This is an image upload experiment,
**not** OTA or firmware flashing.

## Windows local test

Use a local checkout of `arqueomendez/ebadge` with `uv sync` completed
(Pillow and etcpak in its environment). If it isn't present:

```powershell
git clone https://github.com/arqueomendez/ebadge.git D:\Claude\ebadge
cd D:\Claude\ebadge
uv sync
```

Clone/switch to this feature branch:

```powershell
git clone https://github.com/sarthax/superband-web-client-rnd-BG02.git D:\Claude\superband-web-client-rnd-BG02
cd D:\Claude\superband-web-client-rnd-BG02
git fetch origin
git switch feature/bg02-ru50-encoding
```

Create an RU50 file with the *existing* reverse-engineered encoder:

```powershell
cd D:\Claude\ebadge
uv run python D:\Claude\superband-web-client-rnd-BG02\tools\encode_bg02_ru50.py --ebadge-root . --input D:\Claude\ebadge\test.png --output D:\Claude\ebadge\test.ru50
```

Expected output: **29904 bytes**, magic `RU50`, width 240,
height 240, ETC2 payload 28800 bytes.

Run web manager from the feature branch (requires Bun installed):

```powershell
cd D:\Claude\superband-web-client-rnd-BG02\src
bun install --frozen-lockfile
node --test tests/ru50.test.mjs
bun run dev
```

Open `http://localhost:8787/` in current Chrome or Edge, connect your
BG02, choose `test.ru50` in **Choose image / .ru50**, then **Push to active**.
`localhost` is treated as a secure context for Web Bluetooth.

Do not press any OTA/firmware-upgrade controls. You can restore a working
image using the official SuperBand app after the experiment.

## What to report after one real-device attempt

1. Whether the manager accepted the RU50 file (display size + CRC validation).
2. Whether `DIAL_START_ACK(1000)`, chunks and `DIAL_FINISH_OK(2)` completed.
3. Whether the BG02 screen shows the correct picture, black, or a different error.
4. A redacted activity log if it failed. Stop after one full attempt.

If RU50 still displays black, the next step is comparing a sanitized *known-good*
SuperBand image transfer's first payload bytes, image type, and framing. Do not
brute-force vendor commands, alter OTA, or repeatedly transfer random formats.

## GitHub Pages

The fork includes `.github/workflows/pages.yml`, which builds `src/` with Bun
and publishes the static output. In repository **Settings → Pages**, choose
**GitHub Actions**. To test this feature branch without merging, visit the
**Actions → Pages** workflow, select **Run workflow**, choose
`feature/bg02-ru50-encoding`, and run it. Expected Pages address after a
successful deployment:

`https://sarthax.github.io/superband-web-client-rnd-BG02/`

Deploying a manually selected branch may replace the currently published
site; the default branch remains unchanged. For local-only verification,
use `bun run dev` instead.
