# Running the board sketches on a PC

The two sketches cannot be tried here on real boards, so this folder runs their own code as PC programs against the website's real code.

What is real: the sketch files as they are flashed, ArduinoJson, and the Arduino `String`, `Print` and `Stream` classes (taken from the ESP32 Arduino core). What is a stand-in (`runtime.cpp`, `stubs/`): time, the USB line, tasks, Wi-Fi, HTTPS (plain HTTP to a local copy of the website), flash storage (a folder) and infrared (received from a text file, "sent" as a line on the USB line). The stand-ins use the libraries' real function signatures.

```bash
./fetch.sh                      # once: ArduinoJson and the ESP32 core sources
./build.sh transmitter 18811
./build.sh transmitter 18811 practice
./build.sh receiver 18811
node drive.mjs                  # 18 checks, about two minutes
```

`drive.mjs` starts the website on port 18811, runs the boards and checks the whole path: link by code, key kept in flash and never printed, a button pressed on the site sent with exactly the recorded timings, the USB fan test and the 0.8 second gap, restart, Wi-Fi loss, practice mode, saving with no network, sending saved recordings, "Record a button", JSON-only output for the PC tools, erase and renumbering, removal and re-linking.

What this does not show: that the sketches build for an ESP32 (the build workflow compiles them for one on every push), certificate checking, real Wi-Fi, memory use, or infrared timing while Wi-Fi is busy. Those need the boards.
