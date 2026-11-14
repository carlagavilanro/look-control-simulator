# Automatic receiver capture

Firmware `IRCapture-autosave-1` begins listening on GPIO 15 after short startup initialization. A USB charger or power bank is enough. A computer, Wi-Fi connection and running recording script are not required.

## Capture

1. Power the receiver ESP32, with the module wired to GPIO 15, its appropriate supply and common ground.
2. Point the original remote at it. Press and release one button at a time, leaving about one second between presses.
3. Note the order and meaning of the buttons. The receiver saves timings automatically but cannot infer a label such as TV power.
4. Allow a second after the last button press before removing power. Completed records remain in flash across restarts. A power interruption during a write can lose that last unfinished capture.

Every accepted record has a numeric `capture_id`. Files live under `/captures/` in LittleFS flash. The firmware writes and reads back a temporary file before committing a record. It never replaces older captures to make space.

Repeat-only frames, overflow, invalid timing values and signals longer than one second are rejected. Unknown protocols are allowed because their raw timings can still be useful. The receiver does not measure carrier frequency. Existing fan signals use 38 kHz.

Saving stops at 256 captures, 512 KiB of capture data or low filesystem space, whichever comes first. Some remotes send multiple full frames per press. There is no guaranteed capture rate. USB status reports storage problems. The board power LED does not prove a capture saved.

## Download after recording

Connect the receiver by USB and close Arduino Serial Monitor. From this `hardware` folder, substitute its actual port:

```powershell
.\tools\download-receiver.ps1 -Port COM3
```

This writes `signals/receiver-captures.json`, prints capture IDs and retains an export log beside it. A previous download receives a `.bak` copy. The tool verifies the complete export before replacing the computer file. It does not clear the receiver. Reception briefly pauses during download and resumes automatically. Avoid pressing remote buttons during download.

## Name a saved capture

For example, if ID 5 is TV power:

```powershell
node .\tools\signal-tool.mjs add-saved --archive .\signals\receiver-captures.json --id 5 --name tv_power --file .\signals\signals.json --carrier 38
```

Use the ID from your own download and the correct carrier for your remote. Add `--replace` only when deliberately replacing a named command. Other commands remain unchanged and the previous library receives a backup.

The archive is not itself a transmitter library. Label selected captures into `signals.json`, then upload that file through the transmitter's web page or:

```powershell
node .\tools\signal-tool.mjs upload --file .\signals\signals.json --config ..\website\config.local.json
```

Capturing, downloading, labeling and uploading do not send appliance commands.

## USB status and clearing storage

Arduino Serial Monitor must use 115200 baud and Newline:

- `STATUS` reports firmware, storage availability, saved count and bytes.
- `EXPORT` prints the saved archive. The download script normally handles this.
- `ERASE SAVED CAPTURES` explicitly deletes completed receiver captures. Download and verify them first. Nothing clears automatically after download. IDs refer to the particular archive and may be reused after clearing and restarting.

Only the capture directory is cleared by the explicit command. An interrupted temporary record is not a completed capture. After initialization, a later mount failure does not automatically reformat the filesystem. Transmitter files remain unchanged.

## References and verification

Espressif LittleFS example: https://github.com/espressif/arduino-esp32/blob/master/libraries/LittleFS/examples/LITTLEFS_test/LITTLEFS_test.ino

The build uses installed ESP32 Arduino 3.3.11 headers, ArduinoJson 7 and the existing IRremoteESP8266 installation. See `TEST-RESULTS.md` for checks. Software tests do not establish physical power-loss durability or appliance response.
