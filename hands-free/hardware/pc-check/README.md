# Running the board sketches on a PC

The two sketches cannot be tried here on real boards, so this folder runs their own code as PC programs against the website's real code.

What is real: the sketch files as they are flashed, ArduinoJson, and the Arduino `String`, `Print` and `Stream` classes (taken from the ESP32 Arduino core). What is a stand-in (`runtime.cpp`, `stubs/`): time, the USB line, tasks, Wi-Fi, HTTPS (plain HTTP to a local copy of the website), flash storage (a folder) and infrared (received from a text file, "sent" as a line on the USB line). The stand-ins use the libraries' real function signatures.

```bash
./fetch.sh                      # once: ArduinoJson and the ESP32 core sources
./build.sh transmitter 18811
./build.sh transmitter 18811 practice
./build.sh receiver 18811
./build.sh transmitter 18811 unset   # Config.h left as it is in the repository: no Wi-Fi
./build.sh receiver 18811 unset
node drive.mjs                  # 28 checks, about three minutes
```

`drive.mjs` starts the website on port 18811, runs the boards and checks the whole path: link by code, key kept in flash and never printed, a button pressed on the site sent with exactly the recorded timings, the USB fan test and the 0.8 second gap, restart, Wi-Fi loss, practice mode, saving with no network, sending saved recordings, "Record a button", JSON-only output for the PC tools, erase and renumbering, removal and re-linking. Then Wi-Fi over USB on boards built with none: what `hello` answers, names and passwords that are refused, joining at once, the password never printed, digits in a request never sending a fan command, the saved Wi-Fi used after a restart, and `forget-wifi`. Last, one board's storage first under the transmitter's program and then under the receiver's: the website lists it as the receiver with the same key, and its recordings arrive.

What this does not show: that the sketches build for an ESP32 (the build workflow compiles them for one on every push), certificate checking, real Wi-Fi, memory use, or infrared timing while Wi-Fi is busy. Those need the boards.

`./samsung-check.sh` is a separate check, of the website's ready-made Samsung TV buttons against IRremoteESP8266 (built for the PC with the library's own test helpers): the library sends exactly the website's timings for each code, and reads them back as the same code.
