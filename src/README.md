# `src/` — application sources

All runnable client code lives here.

| Path | Purpose |
|------|---------|
| `index.html`, `js/`, `css/`, `*.ts` | Primary Web Bluetooth manager — **Pictures** + **Advanced** tabs (Bun) |
| [`debug-console/`](debug-console/) | Low-level protocol probe |

## Manager setup

```bash
cd src
bun install
bun run dev          # http://localhost:8787
bun run build        # → dist/
bun run preview:dist # http://localhost:8788
```

GitHub Pages build uses `BASE_PATH=/<repo>/` (set in CI).

## Features (summary)

| Tab | Capabilities |
|-----|----------------|
| **Pictures** | Connect, select ordinary photo, BG02 round crop/zoom with ETC2/RU50, upload and persistent status; device details optional, Baji library only on supported devices |
| **Advanced** | OTA package prepare (CDN presets / local ufw), GATT·AE00 probe, JieLi BLE flash, legacy probes, security notes |

Full tables: [`../docs/web-console.md`](../docs/web-console.md) · [BG02 picture release gate](../docs/BG02-PICTURE-RELEASE-CHECKLIST.md) · root [`../README.md`](../README.md).

## Layout (manager)

| Path | Role |
|------|------|
| `server.ts` | Bun.serve + HTML entry / HMR |
| `build.ts` | Production static build (`BASE_PATH`) |
| `preview.ts` | Serve `dist/` locally |
| `js/protocol.js` | Baji + FitPro CD codec, GATT UUIDs |
| `js/fitpro.js` | Dial31 / legacy `0x1A` builders |
| `js/ota-catalog.js` | CDN presets, zip→ufw, catalog probe |
| `js/jieli-ota.js` | JieLi RCSP OTA (`AE00`) |
| `js/advanced.js` | Advanced tab UI |
| `js/ble.js` | GATT UART + DIS + battery (+ optional AE00) |
| `js/client.js` | `SuperBandClient` multi-session hub |
| `js/image.js` | Dial crop / JPEG prep |
| `js/app.js` | Manager UI wiring |

Protocol docs: [`../docs/`](../docs/README.md)
