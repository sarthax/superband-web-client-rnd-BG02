# BG02 browser photo crop + automatic RU50/ETC2

This branch adds a kid-friendly picture workflow for **BG02 / LJ733_MB_V1.5 / V35922**.

## Everyday use

1. Open the Badge Manager using Chrome/Edge over HTTPS (GitHub Pages) or localhost.
2. Connect the BG02.
3. Click **Choose photo** and select a normal JPG, PNG, or WebP.
4. Drag the photo inside the circular badge preview to move it. Use the **Zoom** slider, mouse wheel, or two-finger pinch to change size; **Reset** centers the picture again.
5. Click **Upload picture**. Conversion happens in the browser; no Python, installation, image resizing, or manual RU50 file is needed.

The editor crops to a **round 240×240 viewport** and fills corners with black. The image is encoded to ETC2 RGB8 (using its standards-valid ETC1 individual-mode subset), wrapped in the 0x450-byte RU50 header with the vendor CRC16 fields, and sent through the existing FitPro Dial31 ACK-driven uploader. Total encoded file size should be **29,904 bytes** (28,800 ETC bytes + 1,104-byte header).

The browser-side encoder is **new and requires a real BG02 render test**. The original local `etcpak` encoder is still available as a known-good fallback. The two encoders do not produce byte-identical compressed textures: they choose different ETC2 compression modes, but both are nominally valid ETC2 RGB8 encodings. Do not merge until the badge shows the resulting picture correctly.

## Notes

- The round crop preview is generated using the same geometry as the exported 240×240 image.
- The existing `.ru50` import is retained for advanced troubleshooting.
- Other badges preserve their existing RGB565/JPEG encoding paths.
- Only BG02 uses the round crop workflow and automatic RU50 encoding.
- No file is uploaded to a remote server; image processing happens in the browser and Bluetooth sends it directly to the badge.
- This does **not** modify firmware or invoke OTA.
- The final BLE success acknowledgment does not prove device-side rendering; inspect the screen after upload.

## Lightweight verification

From the `src` directory:

```powershell
node --test tests/ru50.test.mjs tests/device-profile.test.mjs tests/browser-etc2.test.mjs
bun install --frozen-lockfile
bun run build
bun run dev
```

Chrome/Edge local URL: `http://localhost:8787/`.

One real-device test: choose a four-quadrant red/green/blue/yellow JPG or PNG,
center the crop, upload, and verify the display. Then drag/zoom a photograph
and repeat once to check the crop positioning. Capture a sanitized activity
log only if the display is black or the transfer fails.

## Branch/Pages

This branch derives from `feature/bg02-device-aware-ui`, not `main`.
`feature/bg02-ru50-encoding` and `feature/bg02-device-aware-ui` are still
unmerged. If a local agent has additional working changes not pushed to GitHub,
reconcile those first; do not overwrite the working uploader.

To deploy the branch without merging, manually run the Pages workflow from
GitHub Actions and choose `feature/bg02-browser-crop-etc2`. The deployment
will replace the current Pages site until another deployment runs.
