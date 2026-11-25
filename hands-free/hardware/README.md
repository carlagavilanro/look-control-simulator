# Separate IR receiver and transmitter

**November update: both boards can link to the website, and can be set up from the website with no Arduino IDE.** Put the program and the Wi-Fi on each board once from a computer. After that it only needs power: it joins Wi-Fi by itself and works with no computer attached. The receiver sends every signal it saves to the website, where it becomes a named button of a device. The transmitter collects the commands chosen on the website or in the Windows app and sends the infrared. Everything below about local saving, USB tools and the local Wi-Fi page still applies.

```text
Original remote -> receiver ESP32 (GPIO 15) --Wi-Fi--> website (stores devices and buttons)
                                                           |
Windows app / website page: "Use saved devices" -----------+
                                                           |
appliance <- infrared <- transmitter ESP32 (GPIO 4) <-Wi-Fi-+
```

## Linking a board to the website

**No Arduino IDE is needed.** The website's **Boards and Wi-Fi** page (`/boards`, also reached from Setup, and from the Windows app under Use saved devices → Set up a device) does all of it over the USB cable, in Chrome or Edge on a computer:

1. **Connect.** Plug the board in with a USB data cable, press Connect and pick its port. The page asks the board what it is; a board with the current program answers with its kind, its Wi-Fi and its link code.
2. **Program.** Choose Receiver or Transmitter and press Install. The page downloads the program this repository's build made for that board (see below), checks every file's size and MD5, and writes it. Saved recordings, a saved link and saved Wi-Fi are in parts of the flash the page never writes. A board that still has an older program, or none, has to be installed once before the next step works.
3. **Wi-Fi.** Type the name and password of a 2.4 GHz network and press Save. They go down the cable straight to the board, which keeps them in its own storage and joins at once. They are not sent to the website. The same step changes the Wi-Fi later, for instance after a new router; Forget takes it out of the board.
4. **Link.** The page shows the board's six-digit code and links it with one press (or type the code on the Setup page).

After that the board only needs power from any USB supply.

A board can be given the other board's program at any time: on the page, "Which board is this?" stays open, and installing keeps the board's Wi-Fi and its link. The website goes by the program a board says it runs (every request carries its name), so a board that was linked as the transmitter and now runs the receiver's program is listed as the receiver from its next request on, with the same key. Step 4 of the page asks the website what it sees and says so, instead of taking the board's word that it is linked.

How the Wi-Fi gets in: the board reads one line of JSON at 115200 baud, `{"hf":"hello"}`, `{"hf":"wifi","ssid":"...","password":"..."}` or `{"hf":"forget-wifi"}`, and answers with one line of JSON that never contains the password or the board's key. The Wi-Fi is kept in flash (NVS, namespace `hf-wifi`). `Config.h` still works as before for a board flashed from Arduino IDE, and Wi-Fi saved over USB wins over it. On the transmitter the single keys 1 to 7 still run the fan test; a whole line is never taken for one.

Where the programs come from: the build workflow compiles both sketches exactly as they are here (no Wi-Fi in them), `tools/board-programs.mjs` gathers the four files each board needs with a list of sizes and checksums (`board-programs.json`), and they are attached to the release. The website fetches them from the latest release and hands them to the page from its own address (`/firmware/...`).

Flashing from Arduino IDE still works, and is the fallback if the browser cannot reach the board:

1. Open the board's `Config.h` and fill in `WIFI_SSID` and `WIFI_PASSWORD` (a 2.4 GHz network), or leave them and give the Wi-Fi on the Boards and Wi-Fi page afterwards. `CLOUD_HOST` is already the website. Do this only on your own computer, and do not share the file afterwards.
2. In Arduino IDE install the **ESP32** board package and the libraries **IRremoteESP8266** and **ArduinoJson 7**, choose the board and its port, keep the default partition scheme, and upload. Do not choose "Erase All Flash" for a receiver that holds recordings you want to keep.
3. Open the Serial Monitor at **115200 baud**. Within about a minute the board prints `LINK CODE 123 456` (the receiver prints it inside a JSON line, and repeats it every 30 seconds).
4. Sign in on the website, open **Setup**, type the six digits under **Link code** and press **Link**. The board prints `Linked to ...`.
5. Unplug it and power it from any USB supply. It reconnects and carries on by itself.

The website gives each board a key of its own when the code is typed. The key lives in the board's flash (not in `Config.h`) and is never printed. Removing a board on the Setup page makes its key worthless; the board then prints a new code.

What each sketch gains, and what it keeps:

- **Receiver** (`CloudReceiver.h`): still saves every usable signal in its own storage first, with or without Wi-Fi, and never deletes anything by sending. Saved recordings are sent oldest first; ones made offline are sent when the website is next reachable. `STATUS`, `EXPORT` and `ERASE SAVED CAPTURES` work as before, `capture.ps1` and `download-receiver.ps1` keep working, and `CLOUD` prints the link's state.
- **Transmitter** (`CloudTransmitter.h`): keeps its own signal library, the local Wi-Fi page and the USB fan test (`FanTest.h`: send 1 to 7 in the Serial Monitor). A website command arrives as a one-entry library and passes the same checks as a stored signal; the infrared is sent by the main loop with the same 0.8 second gap. `PRACTICE_MODE` still means no infrared, and the website says so.
- **Shared** (`CloudLink.h`, `CloudCert.h`, identical in both folders): the link runs in its own task, so infrared timing and USB commands never wait for the network. The board talks only to a site that proves, through a Let's Encrypt root certificate, that it is `CLOUD_HOST`.

Safety on the way: the website hands a command to the transmitter only within six seconds of the request. A command that is not collected in time is dropped and reported as not sent; it is never delivered late.

How this was checked: both sketches are compiled for an ESP32 on every push (see the build workflow), and their logic, including Wi-Fi over USB, was run on a PC against the website's real code with stand-ins for Wi-Fi, flash and infrared (`pc-check/`). The Boards and Wi-Fi page was run in a browser with a stand-in for the USB port and the flasher. On 25 November 2026 the receiver's program was installed on a real board from that page; the board took its Wi-Fi over USB, reached the website and sent what it recorded. (That first run is also how the kind mix-up above was found: the board still held the key it had been given as the transmitter.) The transmitter's program has not been installed on a real board from the page yet.

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
