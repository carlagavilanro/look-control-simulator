# iControlled Home — midterm source package

October 6 receiver update: power-on capture now saves in receiver flash without a computer. See `hardware/AUTO-CAPTURE.md` for downloading, labeling and transferring saved signals.

This is the complete website plus separate ESP32 receiver and transmitter firmware. The original seven fan captures are included. TV buttons and command handling are implemented; capture the real TV remote before those buttons can operate the TV.

## Start locally

1. Extract this ZIP to a normal folder. Install Node.js 20 or newer.
2. Follow `hardware/README.md` to configure and upload the separate transmitter. Its signal output is GPIO 4. It defaults to practice mode, which emits no IR; set `PRACTICE_MODE=false` for physical operation. Use the compatible library versions described there.
3. In `website`, copy `config.example.json` to `config.local.json`. Set `espUrl` to the transmitter's local IP, `espToken` to the transmitter's token, and `uiToken` to a different random key of at least 24 characters.
4. Open a terminal in `website` and run `node server.mjs` (or `npm start`). The model, fonts and browser runtime are bundled; ordinary startup needs no package download.
5. Open `http://localhost:8787`, enter the `uiToken` as the website access key, and select Connect. Start the camera, create a named profile, and follow calibration and the tour.
6. Choose Fan or TV. Look left/right to navigate and hold center for five seconds to select once. Switch to TV / Switch to fan is also an eye-selectable control.

If port 8787 is already in use, use the existing instance or change `port` in this package's `config.local.json` and open that new port. Do not close unrelated programs just to free the port.

Local camera access works on localhost. A different laptop/tablet needs a trusted HTTPS route to the gateway, as explained in the website README. The Railway server and deployment files are included, but the hosted release has no cloud-to-home controller connection yet.

## Folder guide

- `website/`: interface, MediaPipe worker, profiles, local gateway, cloud login server and tests.
- `hardware/receiver/`: occasional-use capture ESP32, GPIO 15 input.
- `hardware/transmitter/`: always-on transmitter ESP32, GPIO 4 output.
- `hardware/signals/signals.json`: real fan timing library; add real TV captures here.
- `hardware/tools/`: record, validate and upload the signal file.
- `TV-CONTROLS.md`: exact TV command names and capture instructions.
- `validation/`: fresh test and compiler results.

The transmitter reads its persistent LittleFS copy of the signal file; the receiver and computer capture tool may be powered off after upload. The website gateway computer still needs to run for local website commands.

## Verified scope

39 website tests and eight signal-file tests pass. The revised transmitter compiles. A real-browser fixture also verified missing-capture gating, loaded TV power, reconnect status, device switching, and the mobile layout without contacting hardware. Tests use synthetic gaze data and a mock controller, not a physical TV. This revision was not deployed or flashed. Earlier fan Speed down operation was physically confirmed using the original combined-board firmware and the same fan timings. Separate-board capture/upload/power-cycle tests and the remaining physical appliance actions still need bench verification.

No passwords, access keys, private configuration, or Wi-Fi credentials are included. Heater and powered blind control remain unfinished.
