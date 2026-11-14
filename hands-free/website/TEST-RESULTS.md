# Current TV/fan revision — October 5, 2026

39 website tests and eight signal-file tests passed. The revised transmitter compiled for `esp32:esp32:esp32`: 1,004,932 bytes flash (76%) and 47,504 bytes global RAM (14%). No board was flashed, no live IR command was sent, and no deployment was performed in this revision. TV has no real captures yet. Full current logs are in `../validation/`.

The older record below is retained as historical evidence. Its test counts and binary sizes refer to that older revision.

---

# Test results — September 13, 2026

| Test | Result |
| --- | --- |
| Public practice sketch compile | PASS: 989,528 bytes flash; 47,928 bytes global RAM |
| Private practice sketch compile | PASS: 989,560 bytes flash; 47,928 bytes global RAM |
| Private live sketch compile | PASS: 991,136 bytes flash; 47,928 bytes global RAM |
| USB identification | ESP32-D0WD-V3 on COM3 |
| Firmware upload | PASS: flash data verified |
| Wi-Fi | Connected after user enabled original hotspot |
| Served page and status | PASS on actual ESP32 |
| Seven practice fan commands | PASS on actual ESP32 |
| Bad token / missing or malformed ID / foreign Origin | Rejected as expected |
| Unknown command / heater command | Rejected as expected |
| Duplicate request / cooldown | Rejected as expected |
| Browser button mappings / pause / rejection / connection loss | PASS with a simulated HTTP responder |
| Website → gateway → actual ESP32 live command | PASS: IR-send acknowledgement |
| Physical fan Speed down | PASS: user confirmed “it worked!” |
| Exact raw capture preservation | PASS: all seven arrays match supplied captures |
| Gesture / five-second hold / direct send | Twenty-three automated tests passed, covering direct send, tracking-loss handling and named calibration profiles |
| Real MediaPipe worker initialization and empty-frame inference | PASS after fixing loader paths and ES module settings |
| Live front-camera eye overlay | PASS: eye outlines and pupil rings visibly aligned on a person; selected-button highlight visible |
| Person-based eye calibration | Previous gesture calibration reported success; named profiles now restore compatible saved calibration |
| Control usability | User reports the controls are working overall |
| Profile name persistence / removal | PASS through the browser UI with a temporary test profile |
| Calibration persistence and profile switching | PASS with automated stored-data and app integration tests; returning-person trial pending |
| Redesigned desktop and phone layout | Visually inspected; existing command connection retained |
| Other six physical fan functions | PENDING |
| Second device using HTTPS | PENDING |

The downloaded firmware defaults to practice mode; the currently flashed board uses the private live configuration. No video was recorded or uploaded. The model test uses an empty artificial frame and does not demonstrate eye-tracking accuracy.

