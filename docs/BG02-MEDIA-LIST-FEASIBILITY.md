# BG02 media-list feasibility — read-only interface discovery

## Consolidated baseline and user's GATT capture

Feature PRs #1–#3 and #5–#10 were merged to `main`. Peer-transfer
research PR #4 remains separate.

The BG02 V35922 / LJ733_MB_V1.5 GATT probe showed BOTH:
- FitPro UART `7e400001-b5a3-f393-e0a9-e50e24dcca9d`, with
  `7e400002` (write), `7e400003` (notify), `7e400004`.
- JieLi RCSP/OTA service `0000ae00-0000-1000-8000-00805f9b34fb`, with
  `AE01` and `AE02`.
- Standard DIS and battery services.

The earlier Advanced GATT panel displayed `[]` for **every**
characteristic's properties because it tried `Object.entries` on
`BluetoothRemoteGATTCharacteristicProperties`. In browsers those are
often prototype WebIDL accessors, *not enumerable own properties*.
That output did NOT prove AE01 lacked write or AE02 lacked notify.
This branch fixes it by reading the known flags explicitly.

## What is established

- FitPro UART/Dial31 media upload works for RU50, JPEG 4:4:4,
  and AVI; the read-only FitPro `0x20/2` dial info and
  `0x20/4` storage fields are available on this board.
- A changing free-space value was observed to use 8KiB allocation
  increments. The `pictureNums` count byte has **unverified semantics**.
- The Baji media list/delete module (`docs/protocol/media.md`) does
  not apply to this device's FitPro transport.
- **AE00 is physically exposed in the same GATT profile**. This raises
  confidence that further RCSP investigation is worthwhile.
- **No known BG02 file-list transaction or file entry response is yet
  confirmed**. The standard vendor SDK's file browser may only enumerate
  SD/USB music file storage or require authentication/firmware features.

Relevant vendor references:
- https://doc.zh-jieli.com/Apps/Android/jielihome/en-us/master/development/api/file_op_api.html
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/fw-AC63_BT_SDK/9-third-party-integrations/9.1-jl-rcsp.html
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/Android-JL_Health/6-transfer-media/6.1-file-transfer.html
- https://github.com/ElectronicCats/jieli-ble-badge-research

The SDK defines file-browse start/stop opcodes, but they are not sufficient
to infer that BG02 stock firmware accepts them or that its wallpaper
allocation is exposed as an ordinary browsable directory. An RCSP auth
handshake and valid storage handle may also be needed.

## New diagnostics: no device writes

Media Diagnostics now has **Check file-list interface**. It only asks the
browser for `AE00` and enumerates its characteristics and read/write/notify
*properties*; it sends no ATT characteristic data, RCSP request, OTA command,
or media/file delete operation.

Results:
- AE00 + writable AE01 + notifiable AE02:
  **RCSP transport candidate**, not an accepted file list.
- AE00 visible but missing required characteristics/flags:
  incomplete transport (or inconsistent browser GATT capabilities).
- AE00 missing: unavailable **in this connected profile**; another
  proprietary FitPro list mechanism might still exist.
- Permission/transport error: **inconclusive**, not absent.

The panel also retains up to eight user-requested same-session
`0x20/2`/ `0x20/4` readings, showing changes in the candidate count
byte and in reported free bytes. The JSON export includes those readings
and the GATT capability result, without Bluetooth MAC/serial/session ID.
A count delta is not proof of actual filenames or installed-file count.

The Advanced **GATT probe** now displays actual characteristic flags
rather than empty `[]` values on Chrome. Regression tests cover the
prototype-accessor case and check for **zero GATT writes** in the new probe.

## Minimal next local test

1. Start the branch in Chromium and connect the known BG02 V1.5.
2. Run **Advanced → GATT probe**; expect AE01's real `write` or
   `writeWithoutResponse` and AE02's `notify` property if RCSP
   can transport requests.
3. In **BG02 media diagnostics**, click
   **Check file-list interface**. Record whether it reports
   `AE00 transport candidate` or `AE00 incomplete`.
4. Optionally click **Read badge media metadata** twice. The count and
   free-space delta is passive metadata, not a file listing.

With positive AE00 transport support, the next implementation slice is
an explicitly opt-in, narrowly scoped **read-only RCSP identity/auth
capability probe**, using a verified vendor frame parser and timeouts.
Only after that can we qualify read-only browse requests and parse real
file entries. Do NOT send generic file-start, stop, delete, format,
OTA or authentication guesses to discover commands.

Another evidence route is one short Android SuperBand btsnoop capture
while opening the **on-device installed-media** screen. A watchface
catalogue fetched from an HTTP API is not equivalent to the badge's
installed-file inventory.

This branch does not implement deletion, file retrieval, firmware writes,
or any unverified RCSP command.

## Next slice: opt-in RCSP identity-only request (stacked PR)

User's corrected live GATT output confirms:
- `AE01`: **writeWithoutResponse**
- `AE02`: **notify**
- `AE00` and FitPro UART are both exposed.

This completes the **GATT transport capability** check, but is not evidence
of RCSP authentication, target-info support, or an installed-file list.

**Critical protocol correction:** The older `src/js/jieli-ota.js`
`buildRcspFrame` helper arranges length/sequence/opcode in an incompatible
order. Do **not** reuse that helper for this probe or invoke `runJieliOta`.
JieLi's documented RCSP envelope is:

```
FE DC BA | flags(1) | opcode(1) | BE16 bodyLen | body | EF
```

Request body starts with **sequence**; a response body starts with
**status, sequence**. The new isolated
`src/js/bg02-rcsp-target-info.js` implements that envelope only for
the documented, read-only `GET_TARGET_INFO` opcode `0x03`.
A common target-info parameter from published RCSP badge traces is
`FF FF FF FF 00`, prefixed by the sequence number. The one request is:

```
FE DC BA C0 03 00 06 00 FF FF FF FF 00 EF
```

### Manual test

1. Connect known BG02 V1.5; run **Check file-list interface**.
2. Only if `AE00 transport candidate` appears, click
   **Read RCSP target identity (one request)** and approve its confirmation.
3. The browser starts `AE02` notifications, sends the single frame above
   via `AE01.writeValueWithoutResponse`, and waits at most five seconds.
   It matches opcode, direction and sequence, reassembles fragmented
   notifications, and removes its listener/subscription afterward.
4. Record the status message: **response received (status/length)**,
   **timeout**, or **Bluetooth error**. The raw payload is deliberately not
   logged/exported because it might include per-device identifiers.
5. If a response arrives, the RCSP **identity request** is demonstrated.
   It still does not establish auth success or file browse. If it times out,
   auth or unsupported firmware remain possible. No automatic second request.

**No** firmware update operations, file-list request, storage enumeration,
unknown probing, deletion, formatting, or authentication bypass is performed.

Vendor references:
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/WeChat-Mini-Program-OTA/3-bluetooth/2-ble-data-handler.html
- https://github.com/jumpingmushroom/e87_badge/blob/main/docs/protocol.md
- https://doc.zh-jieli.com/SDKWiki/master/Jieli-Tech/fw-AC63_BT_SDK/9-third-party-integrations/9.1-jl-rcsp.html
