# Receiver automatic storage update — October 6, 2026

- Firmware `IRCapture-autosave-1` compiled for `esp32:esp32:esp32` with ESP32 Arduino 3.3.11. Program storage: 396,096 bytes (30%). Global RAM: 22,988 bytes (7%).
- Flashed the user-identified receiver on COM3, an ESP32-D0WD-V3. Flash hashes verified and the board restarted. No transmitter board was connected or flashed.
- The real receiver answered the archive protocol with storage ready. Download of its initially empty archive completed and passed verification.
- All 12 signal/archive tests passed, including original fan timing preservation, incomplete/corrupt download rejection, explicit labeling, backup, upload verification and no automatic upload retry.
- PowerShell download script parsed successfully and ran against the real receiver.
- A real remote capture and retention across reboot are pending the physical button-press check. No new appliance transmission or cloud deployment occurred.

The firmware records valid non-repeat captures automatically in receiver LittleFS. It stops new saves at its count/space limit and keeps previous records. It does not wait for a USB recording tool or Wi-Fi. Downloading briefly pauses reception. Interrupted writes, full storage and electrical power-loss recovery are not physically stress-tested.

Binary SHA-256: `F9F0F01AECB18C438E23E92C8E59F13B50C87079E5673FFBAA694D61641296FC`.

---

# Prior TV/fan revision — October 5, 2026

39 website tests and eight signal-file tests passed. The revised transmitter compiled for `esp32:esp32:esp32`: 1,004,932 bytes flash (76%) and 47,504 bytes global RAM (14%). No board was flashed, no live IR command was sent, and no deployment was performed in this revision. TV has no real captures yet. Full current logs are in `../validation/`.

The older record below is retained as historical evidence. Its test counts and binary sizes refer to that older revision.

---

# Validation — separate-board revision

September 15, 2026.

- Eight automated signal-file tests passed: original capture preservation, named updates, invalid/overflow/repeat rejection, long-interval packing, disk backup, upload read-back, mismatch/no-retry behavior, and legacy-firmware detection.
- Receiver USB logger: PowerShell syntax and .NET serial/log object construction verified without opening a board. Capture-to-file command-line workflow verified with a synthetic capture.
- Existing website: all 23 automated tests passed unchanged.
- Receiver-only firmware: compiled successfully for esp32:esp32:esp32; 333,004 bytes flash and 22,756 bytes global RAM.
- Transmitter-only firmware: compiled successfully for esp32:esp32:esp32; 1,004,768 bytes flash and 47,504 bytes global RAM.

Build environment: ESP32 Arduino core 3.3.11, ArduinoJson 7.4.3, installed IRremoteESP8266 reporting 2.9.0. The installed IRrecv source includes ESP32 core 3 timer-API compatibility changes. A clean library installation must likewise support the selected ESP32 core version; otherwise use a compatible core/library pair.

No firmware was uploaded and no physical IR command was sent in this revision. Real receiver USB captures, transfer to the separate transmitter, persistence across power cycling, and file backup recovery under power interruption remain physical checks to perform on the two boards. Prior user-confirmed fan operation used the earlier combined-board firmware and the same raw fan timings.

