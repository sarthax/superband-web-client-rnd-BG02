# BG02 Peer Capture — Android receiver-side connection probe

**Research prototype, not a wallpaper downloader.** The exact BG02 V35922
badge-to-badge protocol is unknown. The JieLi 707N demo uses the advertising
name `wallpaper_adv` for a receiver. This is a **hypothesis to test**, not a
verified BG02 advertisement name or GATT service.

## Purpose

Use an existing **Android phone** (Android 8+, BLE peripheral advertising
required) as a *candidate receiver* while the BG02 itself is in **Send Picture**
mode. This can establish whether the BG02 connects to a name-advertising device,
even if you only own **one** badge.

The app deliberately has no uploader, image storage, or RCSP/OTA/FitPro client:
- It broadcasts the chosen name (default `wallpaper_adv`) as connectable BLE.
- It opens one **custom diagnostic-only** GATT service with dummy read/write
  characteristics, and logs link state, MTU, read/write requests and lengths.
- It returns only ordinary GATT acknowledgments for the dummy service and
  **discards write bytes**. No wallpaper-transfer protocol is implemented.
- It never initiates a BLE connection, sends app commands, pairs on purpose,
  or flashes devices.
- The on-screen and clipboard summaries redact **all raw BLE addresses** using
  session-specific salted hashes and never include raw characteristic contents.
- It requires foreground interaction and automatically stops after **120 s**.

**Privacy:** No Internet permission, no storage permission, no analytics, no
third-party SDK or external libraries. No raw HCI logs are uploaded. The app
temporarily changes the phone's **system Bluetooth name** to broadcast the
candidate receiver name, restores the previous name when stopped, and warns if
Android refuses that restoration. If the app crashes or Android kills it,
restore the phone name manually under Android Bluetooth settings.

## Build / install

The draft PR research branch publishes a **debug APK only as a GitHub Actions
run artifact**. Open the `BG02 Android receiver capture build` action run,
download its `bg02-peer-capture-debug-apk` artifact and install the enclosed
`app-debug.apk` manually on your own Android phone. This is a debug-signed
local diagnostic, not a Play Store release. Keep the APK private and review the
source if you prefer before sideloading. Uninstall after the experiment.

From Android Studio, open this directory as a standalone Gradle project and
run `:app:assembleDebug`; requires JDK 17, Android SDK 35 and Gradle 8.9.

## One test

1. Disconnect the SuperBand phone app and existing browser/Windows BLE session.
   Turn off SuperBand's automatic reconnection if needed.
2. Open **BG02 Peer Capture** on Android. Grant **Nearby Devices** permission.
   Keep it in the foreground.
3. Keep the default candidate name `wallpaper_adv`, and press **START**.
   Confirm it says `ADVERTISE_STARTED`. If Android doesn't support LE
   advertising, the tool will report the limitation.
4. On your badge, enter **Send Picture**, start discovery, and check whether
   the Android phone appears. If you can select the phone, select it once.
   Do **not** attempt to reflash or use the RCSP target-info script.
5. Stop within 120 seconds, verify that the phone's Bluetooth name has been
   restored, and press **COPY SANITIZED SUMMARY**.
6. Share the summary text, **not a raw Android bug report**.

## How to interpret

- `ADVERTISE_STARTED` alone proves **only that Android accepted advertising**.
- `GATT_LINK: CONNECTED` while BG02 is discovering would be useful
  **receiver-discovery evidence**, especially if accompanied by a visible
  badge action. It does not prove media delivery.
- `GATT_WRITE` on our dummy diagnostic characteristic means the client wrote
  to **that specific unrelated test service**, not that a picture was sent.
- No connection is **inconclusive**: stock BG02 may expect a different local
  name, service UUID, service data, manufacturer data, or another BLE role.
  Do not interpret a zero-result as proof peer sharing is impossible.

Do not add BG02's known **AE00 OTA**, **7E40 FitPro**, or another guessed UUID
to this receiver and imply it matches the peer image-transfer protocol.
First analyze a real transfer or obtain the actual `wallpaper_sharing_main.c`
from the vendor's 200patch04+ demo.

## References

- JieLi vendor [707N BLE image-sharing demo](https://doc.zh-jieli.com/KDocs/master/手表穿戴技术应用文档入口汇总/707电子吧唧开发资料/707N蓝牙互传图传demo/)
- Android [BluetoothLeAdvertiser](https://developer.android.com/reference/android/bluetooth/le/BluetoothLeAdvertiser)
- Android [BluetoothGattServerCallback](https://developer.android.com/reference/android/bluetooth/BluetoothGattServerCallback)
