# BG02 Android Bluetooth HCI bug report — sanitized result

**Source:** user-supplied Android 16 full bug-report ZIP, captured November 11, 2026. **Raw ZIP/HCI dump remains private and is NOT committed.** Analysis was read-only and no device interaction occurred.

## What the captured phone session actually shows

- `FS/data/log/bt/btsnoop_hci.log` is a valid **btsnoop v1 / HCI H4** trace, **1,055,441 bytes** and **4,612 HCI records**. `dumpstate.txt` includes SuperBand application logs.
- Android detected two **BG02-named** extended advertising events around **12:12:30** (phone log time) and connected to BG02 around **12:12:43**. The Android GATT discovery found both the JieLi **AE00** service and **7E40** UART service. Its DIS firmware-revision read returned **V35922**.
- This connection sent **72 ATT Write Commands** to UART characteristic `7E400002` and received **44 notifications** on `7E400003`; messages used **FitPro/Baji CD/DC framing**. No writes were observed to **AE01**, nor notification enabling for **AE02** on this connection. The previously successful **Windows** six-step JieLi authentication is a **separate test**, not included here.
- At approximately **12:13:01–12:13:14**, SuperBand's `PicturePushActivity` and `PicturePushViewModel` selected/cropped a JPEG for a **240×240** screen and uploaded it **phone → BG02** over FitPro module `0x1F`, with `0x20` responses / ACK progress counters **1000 → 1001 → 1002**, followed by application-level **transfer success**. Some `INVALID_PACKET` diagnostics appeared during the accepted upload, but the app still recorded a successful result.
- **No observed `wallpaper_adv` advertisement**, generic RCSP `GET_TARGET_INFO` response, badge-to-phone download, or true badge-to-badge image transfer. Absence of `wallpaper_adv` is inconclusive: this was not a controlled normal-versus-Receive Picture scan.

## Implications for Share/Receive

This is **valid phone-side Bluetooth logging** and a useful confirmation of the working FitPro uploader, but **it did not capture image readback or the peer-sharing handshake**. Android's HCI snoop records **this Android phone's controller traffic**; it cannot see traffic exchanged only between two separate badges.

Do **not** use this ZIP as proof that BG02 V35922 lacks readback or that JieLi RCSP requires different opcodes. The only direct RCSP evidence remains the prior authenticated Windows session with a silent post-auth `0x03` request.

## Next concrete evidence gate

1. Use the already implemented passive **`tools/bg02_peer_advertisements.py`** for one Normal → **Receive Picture** comparison with the phone disconnected, if not yet run. It gathers anonymized advertising names, UUIDs and payload fingerprints, not GATT traffic.
2. If that reveals a role-specific advertisement, use it to guide **receiver-side capture/emulation**. If not, obtain the missing JieLi **200patch04 peer-sharing** source or capture a real transfer between two compatible badges with appropriate BLE sniffing.
3. Avoid repeating the earlier RCSP identity query. Preserve the locally modified `--raw-log` probe without overwriting it.

**Privacy:** Full Android bug reports and snoop captures can contain device identifiers, app content and uploaded image bytes. Do not post the original archive or unredacted HCI log to public GitHub issues.
