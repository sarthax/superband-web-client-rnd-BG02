# BG02 local-agent handoff — obtain a read-only device media inventory

**Owner's goal:** Recover the BG02's actual installed image/video inventory
(filenames or IDs, types, sizes, possibly thumbnails) so the web client can
eventually display a media library. Do not confuse an app/cloud catalogue with
files actually stored on the badge. **One local Claude agent, end to end.**

## Confirmed hardware and traffic (2026-11-11/12)

- Device: **BG02**, firmware **V35922**, DIS board **LJ733_MB_V1.5**,
  240×240 screen, dial algorithm **4 (JPEG)**.
- **Working app upload/telemetry:** FitPro over UART service
  `7e400001-b5a3-f393-e0a9-e50e24dcca9d`, write
  `7e400002` (write/writeWithoutResponse), notify `7e400003`;
  `7e400004` is readable/writable/notifiable.
- Confirmed read-only FitPro `0x20/2` dial-info and `0x20/4`
  candidate free-media bytes. The latter responded with **151,552 bytes**
  (148 KiB) on 2026-11-12. Allocation movement observed in **8KiB
  increments**. This is **not** a full file list or proven capacity.
- JPEG 4:4:4 static uploads and 1fps MJPEG AVI playback work on device.
  These writes do not imply any file-list opcode exists.
- **Second service present:** `0000ae00-0000-1000-8000-00805f9b34fb`
  (JieLi RCSP/OTA), `AE01` supports
  `writeWithoutResponse`, `AE02` supports `notify`.
- Opt-in one-shot RCSP **GET_TARGET_INFO `0x03` timed out** at 5s.
  AE01 wrote without browser error; prior code did not record whether
  AE02 delivered unrelated or unparsed packets. A follow-up in PR #12
  now reports RX notification count, bytes, complete/unmatched frames.
  **Do not assume firmware lacks RCSP or that authentication is proven.**
- Legacy **Baji media module `0x02`** commands operate on a different
  protocol. Never send Baji MEDIA_DELETE or format opcodes to FitPro BG02.

## Repo sources — read these first

- `docs/BG02-V35922-OTA-FIRMWARE-ACQUISITION-HANDOFF.md` — complete OTA acquisition history, original APK/HTTP catalog workflow, related-device ZIP receipts, and why no **BG02 V35922** stock image was obtained. Do not conflate a related firmware with an exact hardware match.
- `docs/BG02-MEDIA-LIST-FEASIBILITY.md` — current GATT/RCSP result,
  protocol framing and caveats.
- `docs/BG02-STORAGE-READONLY.md` — confirmed FitPro hex packets,
  response examples and free-space evidence.
- `docs/BG02-VIDEO-AVI.md` — actual Dial31 AVI transfer evidence.
- `docs/BG02-PICTURE-QOL-MEDIA-DIAGNOSTICS.md` — why old Baji media
  manager is hidden.
- `docs/protocol/media.md` — **Baji only; negative comparison**, not
  permission to use its opcodes on BG02.
- `src/js/bg02-rcsp-target-info.js` — one-shot identity probe;
  RX count instrumentation; this is diagnostic code, not a validated
  RCSP login or file-list client.
- `src/js/bg02-media-capabilities.js`, `src/js/fitpro.js`,
  `src/js/client.js`, `src/js/ble.js`.

### Vendor references (read as reference, not proof of this firmware)

- JieLi Home Android SDK file operation API:
  https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/api/file_op_api.html
- JieLi SDK file-browser walkthrough (mostly **music on SD/USB**, not
  proof that electronic-badge wallpapers are exported):
  https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/Android-JL_Bluetooth/device-functions/file-browser.html
- JieLi Home SDK Bluetooth options, including optional **device auth**:
  https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/import.html
- JieLi RCSP core API:
  https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/api/rcsp_basic_api.html
- JieLi RCSP BLE framing docs:
  https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/WeChat-Mini-Program-OTA/3-bluetooth/2-ble-data-handler.html
- JieLi electronic badge 707N demo / SDK pointers:
  https://doc.zh-jieli.com/KDocs/master/%E6%89%8B%E8%A1%A8%E7%A9%BF%E6%88%B4%E6%8A%80%E6%9C%AF%E5%BA%94%E7%94%A8%E6%96%87%E6%A1%A3%E5%85%A5%E5%8F%A3%E6%B1%87%E6%80%BB/707%E7%94%B5%E5%AD%90%E5%90%A7%E5%94%A7%E5%BC%80%E5%8F%91%E8%B5%84%E6%96%99/
- Independent JieLi badge reverse engineering:
  https://github.com/ElectronicCats/jieli-ble-badge-research
- Platform-independent Python BLE toolkit:
  https://bleak.readthedocs.io/en/stable/
  (Windows uses the WinRT backend).
- Historical BG02 app observation: `btsnoop_hci.log` from the user's
  Android capture, **if available locally**. Do not assume it is
  checked into this private repo. Obtain it from the owner if absent.
- The **original SuperBand APK**, if user has it: analyze locally with
  jadx/apktool. Never download random APKs or assume a different model's
  APK is interchangeable.

## Preferred workflow: evidence, then one targeted live probe

1. **Inspect repo and local evidence.** Confirm branch/head. Locate the
   user's HCI snoop and any authorized SuperBand APK. Extract just
   FitPro/RCSP notification/write pairs, BLE services, vendor handlers and
   media-management UI calls. Identify whether the original app even uses
   **AE00** when opening on-device media, versus only **7E40**.
2. **Separate app catalogue from badge file inventory.** Find the code
   path for *installed/on-device media*, not the cloud library. Trace
   its exact command + expected response schema/sequence, if present.
   The SDK's generic `listFiles` may browse SD/USB music files only;
   don't assume it lists wallpapers.
3. **Build one minimal Windows BLE harness** using Python `bleak`
   (if the local Windows host can access the adapter), or control a
   real headful Chromium Web Bluetooth session if that is simpler.
   Use async notifications, monotonic timestamps, raw frame-capture
   to **local scratch only**, fragmentation-aware decoding, timeout
   and clean disconnect. Redact MACs, names/serials, tokens and raw
   identity data from PRs/logs shared remotely.
4. **Avoid competing connections:** only ONE of SuperBand Android app,
   browser Badge Manager, or the Python BLE harness should own the
   badge at a time. If Python cannot obtain the device, close the
   browser/app first and reconnect explicitly.
5. Reproduce **one already documented read-only request** in the harness
   to qualify its transport. If using RCSP target-info, compare the exact
   framed bytes and record *received notifications, bytes and parsed
   frames* to determine whether the timeout was genuine silence or a
   parser mismatch. Stop repeating it if silent.
6. **Only after obtaining evidence for a specific read-only listing
   transaction** (SuperBand APK/HCI or exact matching firmware SDK
   implementation), allow a single controlled on-device query for
   listing, with request/response logging and a timeout. Confirm
   returned records represent resident media by comparing changes
   against the badge UI/storage data. No speculative opcode sweeps.
7. If an authenticated AE00 session is required, first **identify its
   legitimate vendor SDK/official-app handshake** and determine whether
   the BG02 actually performs it. Don't guess keys or brute-force it.
   Do not claim authenticating an RCSP OTA service alone means file
   browsing is supported.
8. If a real list works: implement **read-only enumeration only** in
   a separate `bg02-media-list` module, guard to the exact board and
   firmware, and add a useful list UI (ID/name, type, size, source,
   uncertain fields labeled). Never silently activate the Baji
   list/delete UI.
9. Do **one concise end-to-end shakeout**, using a real listing:
   names/types/sizes make sense, empty list works, disconnect/timeout
   cleanly handled, no unintended media modification. Avoid a large
   battery of repetitive tests.

### Safety and stopping rules

- **No firmware updates, OTA enter/exit, reboot, erase, format, delete,
  factory reset, file overwrite, badge-to-badge transfer, or mass file
  requests.** Do not try vendor commands of uncertain effect on the
  badge. Ask user explicitly before any state-changing test.
- No Bluetooth brute force, random command ID scans, auth bypass,
  guessed secret keys, or repeated timeouts. Rate-limit and bound all
  experiments; use a clear stop condition.
- Use the public, authorized vendor material and any user-provided
  APK/captures. Vendor SDK documentation does not confer access to
  private firmware/repositories or their proprietary binaries.
- The already working JPEG/AVI/RU50 uploader stays untouched.
- Never merge PRs to `main` without owner approval; use a feature
  worktree/branch. Keep the generated scratch captures **out of git**.

### End-of-task output required

Give the owner one compact report:

- **Verdict**: `LIST_CONFIRMED`, `TRANSPORT_ONLY`,
  `AUTH_REQUIRED_OR_SILENT`, `NO_BG02_LIST_EVIDENCE`, or
  `BLOCKED_NEEDS_APK_OR_CAPTURE`.
- Which transport the official BG02 app uses for stored-media management.
- Exact commands **confirmed by evidence** (not guesses), redacted
  request/response samples, any parsed entry schema and confidence.
- What was actually sent to the badge; whether any media changed.
- One branch/PR if implementation succeeded, or a short research
  document + next single blocker if it did not.
- Do not consume hours on inconclusive opcode experiments. Stop and
  report rather than expanding the scope.

## Suggested local Claude Code task

> Take ownership of BG02 device-media enumeration end to end. Start by
> reading `docs/BG02-LOCAL-AGENT-HANDOFF.md` and the referenced files
> in `sarthax/superband-web-client-rnd-BG02`. Work on Windows with
> physical BG02 V35922/LJ733_MB_V1.5, single-agent workflow.
> Verify the original SuperBand APK and btsnoop if available locally,
> identify whether on-device media listing uses FitPro 7E40 or
> authenticated JieLi RCSP AE00. Build a small Bleak capture/replay
> harness as needed, and use only **evidence-backed read-only commands**.
> No blind scans, auth guessing, OTA, delete, format or factory reset.
> If you identify and verify an actual list response, implement a safe
> BG02-only read-only list view with one practical browser/device check.
> Otherwise record the exact blocker and stop. Don't touch the working
> JPEG/AVI editor, don't merge `main`, and provide a compact result
> without dozens of microtests.
