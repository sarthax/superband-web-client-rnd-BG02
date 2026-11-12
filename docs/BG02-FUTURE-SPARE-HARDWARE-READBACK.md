# BG02 V1.5 — future spare-unit wired-access / stock-firmware readback plan

**Status: RESEARCH ONLY / DEFERRED UNTIL A SPARE IS AVAILABLE.**
Recorded 2026-11-12. The owner has **one working BG02 badge** and does
**not authorize opening, soldering to, entering download mode on, resetting,
dumping, or modifying that device**. This document is a reference for the
future purchase of a *separate spare unit*. Do not begin physical tests now.

## Why preserve this research?

The original SuperBand OTA catalogue returned HTTP 200 and
`{"success":true,"data":null,"error":null}` for **both**
`name=BG02&type=1&version=V35922` and
`name=LJ733_V1_BadgeOK&type=1&version=V35922`.
Neither query yielded a downloadable firmware package. The installed
firmware on the owner's BG02 is **V35922** and the DIS hardware revision
is **LJ733_MB_V1.5**, 240×240 display; exact stock `V35922` firmware
has **not been obtained**. A predecessor-version OTA entry is only a
hypothesis, not an identified download.

Our related-device UFW analysis found JieLi **AC707N** firmware/bootloader
families with USB/UART debugging and forced-update references, an
approximately 4 MiB SPI NOR flash map, and a **0xB165 chipkey in the
DG01 V1.2 package**. These are *related-device facts*, **not** verified
pinout, chipkey, geometry, or readback permission for BG02 V1.5.
See [firmware hardware](protocol/firmware-hw.md),
[OTA research](protocol/ota-firmware.md) and
[security research](protocol/security.md).

A published third-party project documents dumping another JieLi
AC707N/BR35 e-badge (E87) using exposed USB `DP`/`DM`/`GND` pads,
USB download / UBOOT mode and `jl-uboot-tool`. That project reports
a **4 MiB** read, e.g. `read 0x0 0x400000`, on *its own* E87.
**It is not proof that our BG02 V1.5 exposes identical pads, the same
USB mode, a 4 MiB readable region, or the same credentials.** The
ElectronicCats E87 PCB and chipkey are different from our related
DG01 evidence. Never cross-flash firmware or transplant the chipkey,
pad map or tool parameters.

Primary sources:
- [ElectronicCats: dump and restore stock firmware (E87; USB-ISP)](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/docs/dump-firmware.md)
- [ElectronicCats research README — E87 hardware identity and limitations](https://github.com/ElectronicCats/jieli-ble-badge-research)
- [ElectronicCats: UBOOT recovery / OTA notes (E87)](https://github.com/ElectronicCats/jieli-ble-badge-research/blob/main/docs/ota-howto.md)
- [JieLi/AC707N related badge hardware findings in our repo](protocol/firmware-hw.md)

## Important distinction: BLE "UART" is not a wired UART port

The live BG02 exposes **Bluetooth GATT** service
`7e400001-b5a3-f393-e0a9-e50e24dcca9d` (write `…002`,
notify `…003`, additional read/write/notify `…004`). That
service implements a *UART-like BLE data channel* for FitPro frames.

**It does not mean the same wires physically leave the chip.**
Physical UART TX/RX pads may exist but are unverified. This family also
supports a separate JieLi **AE00** BLE RCSP/OTA transport: that too
does not reveal a physical serial pinout or a firmware-dump command.

Possible *independent* wired interfaces on a spare:
1. **Logic-level UART (TX/RX/GND):** could give boot logs or a downloader
   if implemented and enabled. A USB-to-TTL UART adapter is required;
   the USB cable itself must not be attached to TX/RX.
2. **Native USB (D+/D−/GND):** may allow a vendor USB download/UBOOT
   session via a USB data adapter if the SoC pins are routed and the
   board can enter the appropriate mode. A USB-to-UART adapter does not
   substitute for native USB.
3. **SPI NOR test points / external flash:** possible alternate read
   path if the PCB actually has accessible SPI NOR. Reading it off-board
   or in-circuit requires confirmed voltage, pinout, and ensuring the
   SoC is not also driving the bus. This is not assumed to be simpler.

## Future spare: progressive, non-destructive procedure

### Stage 0 — verify the spare before opening

- Record the spare's **actual** DIS firmware `0x2A26`, DIS hardware
  `0x2A27`, GAP name, screen dimensions, GATT services, and label.
  A later "BG02" badge may have a different board, chip or firmware.
- Confirm whether it is BG02 / `LJ733_MB_V1.5` / `V35922`.
  If not, keep the results **separate**. A dump of a related V1.2/other
  version is useful for comparison but **not** a verified V35922 image.
- Photograph the untouched case and charging connector. Do not assume
  two charging contacts carry USB data (often power only).
- **Stop and preserve the working original badge. Only the spare is a
  potential test subject.**

### Stage 1 — identify, don't energize

- Only if the spare case can be opened without unacceptable risk,
  photograph **both PCB sides** at high resolution. Record board
  silkscreen and all chip markings (SoC, NOR flash, display/touch).
- Inventory visible pads and labels: `GND`, `TX`, `RX`, `DP`,
  `DM`, `D+`, `D-`, `VBUS`, `RST`, `BOOT`, test pad
  numbers. **Do not rely on label guesses; they can be unrelated.**
- With all power disconnected and the battery safely isolated,
  use continuity testing to establish ground, charger contacts
  and obvious line routing. If the battery cannot safely be isolated,
  stop rather than applying continuity or probing in-circuit blindly.
- Cross-check the *exact* SoC package and PCB traces against
  legitimate datasheets. Do not borrow pin assignments from an E87,
  DG01 or generic AC707N demo board without confirmation.
- Do not attach wires, short pads or inject power at this stage.

### Stage 2 — choose a candidate interface

- If **UART** pads are actually confirmed, determine I/O logic
  voltage, common ground and appropriate current-limited adapter.
  Capture *passive boot logging* first, using receive-only wiring,
  and only enable a TX line if a documented non-destructive query
  is known. No baud sweeping that transmits random data.
- If **native USB D+/D−** are confirmed, first determine the
  correct safe 3.3 V/5 V domain and power/USB mux. Never connect
  the PC's USB +5 V to an unidentified test pad; avoid powering the
  board from two supplies simultaneously.
- Vendor USB downloader/UBOOT entry may require boot straps or
  a specific boot state. **A boot/reset/ISP entry attempt is itself
  a hardware operation** and should wait for an explicit owner
  go-ahead once pads and voltage have been reviewed.
- For **SPI NOR**, record exact chip markings/capacity and seek a
  verified read-only interface. An in-circuit clip can short
  traces or back-power the MCU; do not use one blindly.

### Stage 3 — readback (requires a separate owner approval)

Only after the spare's pinout, power, device identity, flash geometry
and read-only downloader path are confirmed:

1. Establish a read-only vendor tool session and identify the target.
   The E87 reference uses the BR35-capable fork of
   `jl-uboot-tool` (`jluboottool.py`) and its own USB/UBOOT mode.
   **Read that tool's help and chip table for the *actual spare*.**
2. Take a minimal harmless identification/read test before choosing a
   full region. The 4 MiB `0x400000` extent is **E87-specific evidence**,
   not an automatic BG02 command.
3. If safe, capture a complete **byte-exact** stock flash backup
   for the spare, recording capacity, tool version, serial/session
   mode, SHA-256, and repeat-read hash consistency where feasible.
   Store the original dump offline, **never rewrite it**, and verify
   it before any further experiments.
4. A raw flash dump can contain the badge's Bluetooth identity,
   `key_mac`, pairing information and personal media. **Do not commit
   full dumps or MACs to GitHub** or share them as a generic firmware
   download. Redact any excerpts in documentation.
5. Decode **offline** first: partition map, bootloader, app/code,
   UI/game resources and image/AVI filesystem. A dump may help
   media enumeration, but does not guarantee a reusable OTA image.

**Never flash, erase, write, reset NVRAM, brute-force keys, enter
unverified production/test modes, or try a related V1.2 image as a
"recovery experiment".** Obtaining a spare does not authorize these
operations. Backing up first is the only near-term objective.

## Future agent task / stopping conditions

> A spare BG02 is now available. Read
> `docs/BG02-FUTURE-SPARE-HARDWARE-READBACK.md` and its source links.
> Do **not** touch the owner's original functioning badge.
> Identify the spare's exact firmware/hardware and photograph both PCB
> sides. Determine only whether native USB D+/D−, UART TX/RX and/or
> external NOR pads are present and safely accessible. Distinguish
> evidence from E87/DG01 from the BG02 hardware. Do not attach USB,
> enter UBOOT, or issue flash commands until the owner approves the
> proposed electrical connection. If approved, prioritize a *read-only*
> full flash backup with SHA-256 and private storage. Stop at the
> first uncertain voltage, pinout, boot procedure or geometry.

Status labels for a future report:
- `SPARE_NOT_AVAILABLE` — current state.
- `PCB_PHOTOGRAPHED_PINOUT_UNCONFIRMED` — no wiring.
- `WIRED_READ_INTERFACE_IDENTIFIED` — physical/electrical path credible.
- `READBACK_CONFIRMED_SPARE` — own spare dumped and hashes recorded.
- `EXACT_BG02_V35922_DUMP_CONFIRMED` — only if spare version/board
  really match and dump is independently verified.

## Keep these separate

- **Current sole working BG02:** preserve intact, no physical investigation.
- **Potential future spare:** reversible disassembly and analysis only
  with new approval for each hardware-connection stage.
- **Other badges (E87/DG01/BJ-1):** reference implementations and
  comparative firmware, never exact replacements for BG02 V1.5.

Last updated: 2026-11-12. No physical testing, commands, USB connection,
boot-mode attempt, or firmware readback performed by this documentation work.
