# Separate IR receiver and transmitter

**October 6 update: the receiver saves automatically when powered.** It does not need a computer, running script, Wi-Fi or the transmitter to record. See [Automatic capture](AUTO-CAPTURE.md) for downloading and naming stored captures. The live USB workflow below remains available.

This replaces the combined receiver/transmitter sketch with **two independent ESP32 projects**.

```text
Original remote -> receiver ESP32 (GPIO 15)
                         |
                 automatic LittleFS archive
                         |
          USB download and labeling on computer
                         |
                  signals/signals.json
                         |
                one-time Wi-Fi file upload
                         |
               transmitter ESP32 flash
                         |
Website command -> transmitter (GPIO 4) -> appliance
```

The receiver can be powered off after capture. The transmitter does not connect to the receiver or read files from your computer during normal operation. It reads **its own persistent copy** of `/signals.json` from LittleFS flash storage. No shared drive, cloud service or SD card is required.

## What is included

- `receiver/IRCapture/IRCapture.ino`: receiver-only firmware. Uses GPIO 15 and automatically saves usable captures in LittleFS flash. Live USB output at 115200 baud remains available. No Wi-Fi or transmitter code.
- `transmitter/IRTransmitter/IRTransmitter.ino`: transmitter-only firmware. Uses GPIO 4. Keeps the existing website command API and adds authenticated signal-file upload/download.
- `signals/signals.json`: all seven original fan captures, with the exact timing arrays preserved.
- `tools/capture.ps1`: Windows recording tool. Saves every received capture record during the recording session, plus the complete serial text log.
- `tools/download-receiver.ps1`: downloads previously saved captures without deleting them.
- `tools/signal-tool.mjs`: validates files, assigns a capture to a named command, and uploads with read-back verification. Requires Node.js 20+; no npm packages are needed.
- `test/`: automated file and workflow tests.

## 1. Set up the receiver board

1. Connect the IR receiver output to **GPIO 15** on its own ESP32, with power and common ground appropriate for your module.
2. Open `receiver/IRCapture/IRCapture.ino` in Arduino IDE. Leave its `Config.h` beside the sketch.
3. Install **IRremoteESP8266** and **ArduinoJson 7** through the Arduino Library Manager. Install the ESP32 board support package.
4. Select the receiver board and its USB port, and upload **this receiver sketch only**.
5. Close Arduino Serial Monitor before running the capture tool; only one program can use the USB serial port at a time.

The receiver has no Wi-Fi credentials. After its short startup initialization, usable non-repeat captures save on the receiver itself. A computer is only needed to download/name them or use the optional live USB workflow. Select a partition scheme with a filesystem partition, such as the default ESP32 layout. Do not select Erase All Flash when updating if you want to retain captures. Finite buffers cannot guarantee lossless recording of arbitrarily fast signals. Repeat-only, overflowed and invalid captures are rejected for permanent storage.

## 2. Set up the always-on transmitter

1. Connect the IR transmitter signal input to **GPIO 4** on the second ESP32. No IR receiver is needed on this board.
2. Open `transmitter/IRTransmitter/IRTransmitter.ino`. Keep all headers in that sketch folder.
3. Fill in **Wi-Fi name**, **Wi-Fi password**, and **CONTROL_TOKEN** in its `Config.h`. The control token must match `espToken` in your website's private `config.local.json`.
4. The download defaults to `PRACTICE_MODE=true`, which accepts commands without emitting IR. Set `PRACTICE_MODE=false` when you want live operation.
5. Select a partition scheme with a filesystem/data partition (the standard ESP32 default works), select the transmitter's USB port, and upload.
6. Read its IP address from Serial Monitor. Set the website's `espUrl` to that address. Keep the laptop and transmitter on the same network for the current local website.

On first use, this dedicated transmitter initializes LittleFS if necessary and installs the bundled fan library into `/signals.json`. After initialization, mount failure does **not** automatically erase storage. Future library changes come from file uploads and do not require firmware recompilation. Do not select "Erase All Flash" when updating firmware if you want to preserve the stored library.

## 3. Capture a button into a file

Open PowerShell in this `hardware` / `IR-Separate-Boards` folder. Use the **receiver's** USB port, not the transmitter's. Replace COM3 below with the actual receiver port.

To recapture the fan power button:

```powershell
.\tools\capture.ps1 -Port COM3 -Name captured_power -Replace
```

Point the original remote at the receiver and press that button once. The first usable, non-repeat, non-overflowed capture updates that named command and ends the recording session. Other commands remain unchanged. A `.bak` copy of the previous computer file is retained.

To save a new named action:

```powershell
.\tools\capture.ps1 -Port COM3 -Name tv_power
```

To log captures without changing any named commands:

```powershell
.\tools\capture.ps1 -Port COM3 -ListenOnly -Seconds 120
```

Logs are written under `signals/capture-logs/`. Each structured record includes the protocol, decoded hexadecimal value/state, bit count, repeat/overflow flags, sequence number, receiver uptime and original timing array. An UNKNOWN decoded value may be a hash; replay always uses **raw timings**, not that hash.

If your PowerShell policy blocks scripts, run this specific local script with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\capture.ps1 -Port COM3 -Name captured_power -Replace
```

This applies only to that process; it does not change the saved Windows execution policy.

The carrier defaults to **38 kHz**, matching the existing fan tests. A demodulating IR receiver does not measure carrier frequency. Use `-CarrierKHz 40`, for example, only when the remote requires that frequency. Repeat frames already present within the raw capture are preserved; no extra repeat train is added.

## 4. Transfer the file to the transmitter

### Easiest: transmitter web page

1. Open `http://TRANSMITTER_IP` in a browser on the same Wi-Fi network.
2. Enter the transmitter's **CONTROL_TOKEN** (not the separate website `uiToken`).
3. Choose `signals/signals.json` and click **Save to transmitter**.
4. Wait for the saved confirmation. You may download the current file from the same page.

Saving a file does not send an appliance command. The new library becomes active without rebooting. You can now unplug the receiver.

### Alternative: verified upload from the computer

Use the website's existing private configuration, which already contains the transmitter address and token. For the full project ZIP's folder layout:

```powershell
node .\tools\signal-tool.mjs upload --file .\signals\signals.json --config ..\website\config.local.json
```

For the standalone hardware ZIP, supply the actual path to your private website configuration instead. The tool checks firmware compatibility, uploads once, then reads the file back and compares its SHA-256. It never sends a fan command or automatically retries an uncertain upload.

## Existing website compatibility

No changes are required to the current eye-control website. Keep these names when recapturing its fan buttons:

| Website button | File command name |
| --- | --- |
| Power toggle | `captured_power` |
| Speed down | `captured_level_down` |
| Speed up | `captured_level_up` |
| Change mode | `captured_mode` |
| Silence | `captured_silence` |
| Turn | `captured_turn` |
| Timer | `captured_timer` |

The included updated website and gateway support seven `tv_` command names. See `../TV-CONTROLS.md` for their exact names and capture instructions. The transmitter advertises its loaded names through `/api/status`; only captured TV actions become available. Heater commands remain disabled.

## File format and recovery

A library has `schema: 1`, `units: "microseconds"` and a `commands` array. Each command contains `name`, integer `carrier_khz`, and positive integer `raw_us` durations alternating mark/space, starting with a mark. Optional `source` metadata is retained in the file. The idle gap before the signal is excluded.

Limits: 32 KB per file, 1–32 commands, 3–2048 original timings per command, 20–60 kHz carrier, and no more than one second of total captured signal. Longer timing intervals are packed for IRsend without changing their duration or mark/space order.

Uploads are validated before writing a staged file. The staged file is reopened and validated before replacing the main file; the previous valid file is backed up. Boot tries the main file, then the backup. A library change or reboot never sends a command. If both saved files are invalid, transmission stays unavailable until a valid library is uploaded.

Endpoints remain local HTTP:

- `GET /api/status`: practice mode, storage state, loaded signal count, loaded command names and file API version.
- `POST /api/command`: same token, command name, request ID and cooldown rules as the existing website.
- `PUT /api/signals`: raw JSON body; requires `X-Control-Token`.
- `GET /api/signals`: downloads the active main/backup library; requires `X-Control-Token`.

Use the current trusted LAN arrangement. Railway hosting, cloud authentication and an outbound cloud device connection are not implemented in this hardware revision.

## Tests and build environment

Run `node --test test/*.test.mjs` from this folder. See `TEST-RESULTS.md` for compilation and validation results. Physical two-board capture, transfer, reboot and IR response still need to be verified on your two boards; neither board was flashed as part of this source-code change.

Sources: [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266), [ArduinoJson deserialization](https://arduinojson.org/v7/api/json/deserializejson/), [ESP32 LittleFS example](https://github.com/espressif/arduino-esp32/blob/master/libraries/LittleFS/examples/LITTLEFS_test/LITTLEFS_test.ino).
