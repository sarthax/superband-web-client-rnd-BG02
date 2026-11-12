# BG02 picture manager — release and cleanup checklist

**Scope:** only the browser picture manager and its static GitHub Pages deployment.
No BLE readback, Android receiver emulation, firmware flashing or OTA.

## Current branch stack (November 11, 2026)

| PR | Change | Merge target |
|---|---|---|
| [#1](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/1) | Verified RU50 container import and FitPro Dial31 upload path | `main` |
| [#2](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/2) | BG02 240×240 device profile, format guard and BG02-only controls | `feature/bg02-ru50-encoding` |
| [#3](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/3) | In-browser ETC2 encode + circular crop/zoom | `feature/bg02-device-aware-ui` |
| Picture cleanup (this branch) | UI-first layout, test fix, accessible status and docs | `feature/bg02-browser-crop-etc2` |
| [#4](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/4) | Separate peer-sharing/readback research | **Exclude from picture release** |

These are stacked GitHub changes, not five separate independent features. Do not squash or cherry-pick blind when local working fixes are not yet pushed.

## Final release gate (one manual session)

1. Preserve the owner’s working local browser copy and any uncommitted changes. Compare its working image encoder/upload path with PR #3 + cleanup branch before merging. If differences exist, integrate only the picture-related, verified changes.
2. Make sure the **single Validate workflow** passes: Node RU50, device-profile and browser-ETC2 tests, Bun production build, and static output check. No repeated BLE protocol testing.
3. Using Chrome or Edge and the exact release candidate, connect **BG02 V35922**. Upload an ordinary JPG/PNG, drag/zoom and upload again. Check the *screen* after the ACK. Also verify .ru50 fallback remains supported. One short smoke run is enough unless something actually fails.
4. Check disconnect/reconnect/switching (if a second badge is available): **keep the chosen photo selected** when moving between badges. The browser may re-prepare the preview for the active device's format, but must not send to another device automatically. The user must explicitly click Upload for each badge, and incompatible formats must be blocked. Confirm BG02 displays fixed 240×240 and does not show Baji library or unrelated OTA presets.
5. Review [#1](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/1) → [#2](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/2) → [#3](https://github.com/sarthax/superband-web-client-rnd-BG02/pull/3) → cleanup PR **in that order**. Only the owner approves merging.
6. After owner approval, deploy merged `main` through [Pages](../.github/workflows/pages.yml). Verify the published site at `https://sarthax.github.io/superband-web-client-rnd-BG02/`, including the correct base path and the still-image round crop. Do **not** deploy research PR #4.
7. Leave PR #4 as draft research or close it separately after owner decision. No requirement to finish peer sharing, GIF/AVI or stored-media downloads for a usable picture manager.

## Acceptance and language

- A completed BLE transfer is **not** display proof; acknowledge transfer, then ask user to confirm the badge shows the photo.
- The manager is static: no cloud image upload or picture gallery API.
- **Browser photos**: JPG/PNG/WebP → circular crop → 240×240 ETC2/RU50 on BG02.
- **.ru50** remains an advanced import/fallback. Generic Baji/FitPro modes retain their original format handling.
- Technical activity logs, diagnostics, protocol probes and OTA controls are under **Advanced**, not the primary Pictures experience.

## Explicitly deferred

- Reading/download of previously stored BG02 media; Baji media-list commands do not prove BG02 support.
- Badge-to-badge image transfer emulation and Android peer-capture experiments.
- Animated GIF/AVI conversion UI; existing third-party conversion experiments can remain independent.
