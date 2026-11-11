# BG02 peer-mode Android HCI bugreport — delta from prior capture

**Status:** Captured the Android phone's continued BG02 connections and FitPro control traffic, **not** a badge-to-badge image transfer. Source is the user's second Android 16 full bugreport. **Raw archives, HCI, device identifiers, names and image bytes remain private**; none were committed.

## Exact capture comparison

| Metric | First report | Second report | Additional |
|---|---:|---:|---:|
| HCI records | 4,612 | 9,139 | **4,527** |
| `btsnoop_hci.log` bytes | 1,055,441 | 2,055,237 | **999,796** |
| LE extended advertising reports | 834 | 1,296 | **462** |

The first snoop file is a **byte-for-byte prefix** of the second. This means the previous successful **phone→BG02 JPEG upload** is not a new upload in the peer-mode period. The appended portion runs from about **12:14:50 to 12:34:19** on the Android device clock.

## Phone↔BG02 events in appended portion

| Time | HCI and Android observations |
|---|---|
| 12:21:25 | Existing connection disconnects, HCI reason `0x08` (timeout); Android reports GATT status 8 |
| 12:22:53, 12:24:22 | LE connection attempts fail (HCI status `0x02`); Android reports status 147 |
| 12:24:53 | Brief successful link, disconnected after ~0.08 s (local host `0x16`) |
| 12:27:22–12:27:32 | Successful phone connection, GATT discovery, timeout/disconnection (`0x08`) |
| 12:28:37 | Another failed create-connection completion; Android status 147 |
| 12:30:50 | Brief connection followed by `0x3E` (connection establishment failure); Android reports 133 |
| 12:32:31–12:33:15 | Successful connection; normal GATT discovery, then **39 ATT write commands on `7E400002`** and **35 notifications on `7E400003`**, followed by disconnection (`0x13`) |

The final session's traffic is the known **FitPro** framing (`CD`/`DC`), with modules including `0x12`, `0x1A` and `0x20`. **No fresh `0x1F` image data** was seen there, so it is not a repeat of the earlier picture upload. The appended phone session also has **no AE01 RCSP write or AE02 subscription**. The separately successful six-step RCSP authentication was a **Windows** experiment, not part of this Android capture.

## Advertising and interpretation

- In the full trace the two named **BG02** advertisements around **12:12:30** are within the original prefix. In the newly appended **462** advertising reports, **neither `BG02` nor the vendor-demo name `wallpaper_adv`** appears as a new visible local name.
- Other advertisers, including unnamed ones, were present. Their identity and BG02 role **cannot be established** just from the snoop.
- Android's snoop observes **its own phone controller**, including advertisements it hears. It cannot capture the GATT conversation of an independent BG02→BG02 link where the phone is **not a participant**.
- User attempted Send Picture and Receive Picture on badge, but Android-side records **cannot tell if a peer was discovered, connected or transferred a picture**. The phone's repeated connection failures are real, but attributing them to Share/Receive role changes remains a hypothesis.

**Verdict:** peer-sharing behavior has **not** been captured or disproven. No media readback or receiver GATT contract has been established.

## Next independent evidence

Use the existing passive `tools/bg02_peer_advertisements.py` once to compare **Normal vs Receive Picture** advertising, with the SuperBand app disconnected, or capture a genuine two-badge transaction with independent BLE radio sniffing. The missing JieLi 200patch04 sharing implementation remains the source alternative. Avoid more unauthenticated or authenticated `GET_TARGET_INFO` retries.

Full private raw Android bugreport should **never** be committed or posted in a PR.