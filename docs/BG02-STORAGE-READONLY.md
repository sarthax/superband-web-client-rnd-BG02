# BG02 V1.5 — model and storage telemetry (read-only)

This note describes **observed** SuperBand Android BLE traffic in `btsnoop_hci.log` recorded 2026-11-11. It supports a narrow read-only diagnostic implementation; it **does not** document any media wipe or factory-format opcode.

## Known hardware

- GAP name: `LJ733_V1_BadgeOK`
- DIS hardware revision: `LJ733_MB_V1.5`
- DIS firmware revision: `V35922`
- Product: BG02; panel 240×240

The standard DIS model number is absent/empty, so the browser manager previously showed a dash. The Baji `0x25` SYSTEM info is not implemented on BG02 and cannot populate its capacity/free space fields. The old manager conservatively skipped FitPro `0x20/2` due to a disconnect observed on **other** BJ-1 hardware.

## Dial info: verified 0x20 / 2

Request: `CD 00 05 20 01 02 00 00`.

Response: `CD 00 25 20 01 02 00 20 01 00 00 F0 00 F0 03 4B 36 36 05 4C 4A 37 33 33 07 04 FF FE 01 05 4A 51 30 30 31 00 00 09 13 88`

- 240×240 display
- `mchModel=K66`; `mainModel=LJ733`
- `algorithm=4` (JPEG path)
- `shortPkgLength=5000`

The new manager probes this only for the **verified BG02 LJ733_MB_V1.5** identity. This query does **not** establish storage capacity.

## Candidate free-space query: 0x20 / 4

Request (read-only): `CD 00 05 20 01 04 00 00`.

Responses, each `CD | length | 0x20 | 1 | 4 | 8-byte payload`:

| UTC time 2026-11-11 | Raw 8-byte payload | BE32 first word | BE32 second word |
|---|---|---:|---:|
| 12:12:52 | `0000000000032000` | 0 | 204800 bytes (200 KiB) |
| 17:58:15 | `0000000000028000` | 0 | 163840 bytes (160 KiB) |

The second field decreases by 40,960 bytes / 40 KiB between sessions, plausibly following changes in stored media. The later query **preceded** the captured 37,896-byte AVI upload. Therefore it must **not** be described as free space *after* that upload.

**Interpretation provisional**: the second 32-bit word is the best observed candidate for available media bytes, not overall flash capacity; the meaning of the first word and any rounding/allocation granularity remain unknown. The 500 KB-ish capacity displayed by SuperBand has not been independently decoded in this HCI log.

The manager displays the second word with a `~` prefix and a tooltip, logs both raw words for comparison, and leaves storage *capacity* unknown. It makes no write beyond those two read-only requests. The probe is restricted to the exact known board revision.

## Verification / next test

1. Connect the BG02 V1.5 to the draft manager. Check model `BG02 (LJ733)`, firmware, hardware, and provisional free-space value.
2. Reconnect in SuperBand and note its free-space number **without uploading or deleting anything between reads**.
3. Compare raw second word, units, and app display. If they agree, drop the provisional label in a later change.
4. Investigate orphaned allocations / media cleanup separately. **Never send generic Baji delete or raw flash erase to this FitPro badge.**

No current source has established a BG02-safe `format` / `delete-all` command.

## Refresh behavior added after first hardware feedback

Earlier manager code only sampled `0x20/4` during connection or **Refresh info**; photo uploads did not request a new reading, so the displayed number stayed stale. The manager now:

- Performs one best-effort read roughly 800 ms **after** an acknowledged Dial31 upload. Its failure does **not** turn a successful transfer into a failure.
- Logs `before`, `after`, and `change` (bytes) when a previous reading exists. A zero delta may mean no visible allocation change, a cached counter, or a wrong interpretation of the provisional field; it must not be treated as proof of a full filesystem.
- Offers **Refresh storage** as a separate read-only button under Device details. It is available only on the verified `LJ733_MB_V1.5` identity and while no transfer is underway.
- Displays **Capacity: Not reported**: the 8-byte `0x20/4` response does not establish total media capacity. Do not hardcode 500 KB from marketing/UI screenshots.
- Preserves the legacy RU50 dial type `0` when `0x20/2` reports JPEG capability, since observing an optional capability must not change pre-existing picture-transfer behavior.

Verify locally with `node --test src/tests/fitpro-bg02-storage.test.mjs` from the repo root (requires Node.js), or `node --test tests/fitpro-bg02-storage.test.mjs` from `src/`. Live browser/firmware verification remains outstanding.

## 2026-11-11 short advertised-name regression (hardware log)

A real BG02 V35922 browser connection reported:

```text
Selected: BG02
DIS: fw=V35922 hw=LJ733_MB_V1.5
DEVICE_INFO_REQUEST 0x25/0x03/0x00
Timeout waiting for DEVICE_INFO_RESPONSE
Protocol: FitPro dial path
```

There were **no** `DIAL_INFO_REQUEST 0x20/2` or `FITPRO_20_04_STORAGE` transmissions, either at connect or after a successful Dial31 transfer. The first draft required `LJ733` in the **advertised name**, while the actual device advertises **BG02**. In addition, `looksLikeFitProBadge('BG02')` returned false and forced the Baji timeout.

Fix: match the exact observed **board revision** `LJ733_MB_V1.5` with either the short **BG02** name or the longer **LJ733_V1_BadgeOK** name. Skip the irrelevant Baji probe for BG02; enable both read-only FitPro telemetry commands and the post-upload refresh. Add an identity regression test using the user's exact reported name/revision. Do not broaden the probe to all LJ733 hardware revisions.

**Minimum validation after pulling**: reconnect **without uploading anything** and check the Activity log for `DIAL_INFO_REQUEST`, `FITPRO_20_04_STORAGE`, and either `BG02 0x20/4: raw=...` or `BG02 storage read unavailable`. This distinguishes command delivery from uncertain free-space semantics.
