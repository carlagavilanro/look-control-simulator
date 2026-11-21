#!/bin/bash
# Fetches the two open-source projects the PC check compiles against: ArduinoJson (the real
# library) and the ESP32 Arduino core (only its String, Print and Stream classes are used).
set -e
cd "$(dirname "$0")"; mkdir -p sources; cd sources
[ -d ArduinoJson ] || git clone --quiet --depth 1 https://github.com/bblanchon/ArduinoJson
[ -d arduino-esp32 ] || git clone --quiet --depth 1 https://github.com/espressif/arduino-esp32
echo "sources ready"
