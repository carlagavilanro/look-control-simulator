#!/bin/bash
# build.sh <transmitter|receiver> <port> [practice]   ->   bin/<board>[-practice]
# Builds a sketch as a PC program: the sketch's own code, the real ArduinoJson and the real
# Arduino String/Print/Stream classes, with runtime.cpp standing in for the ESP32 itself.
set -e
here=$(cd "$(dirname "$0")" && pwd); hw=$here/..; sources=${ARDUINO_SOURCES:-$here/sources}
[ -d "$sources/ArduinoJson" ] && [ -d "$sources/arduino-esp32" ] || { echo "Run fetch.sh first (or set ARDUINO_SOURCES)."; exit 1; }
case "$1" in transmitter) src=$hw/transmitter/IRTransmitter; ino=IRTransmitter.ino;; receiver) src=$hw/receiver/IRCapture; ino=IRCapture.ino;; *) echo "transmitter or receiver?"; exit 1;; esac
mkdir -p "$here/work/core" "$here/obj" "$here/bin"
# The core's text classes are copied out, so that their own #include "Arduino.h" finds the stand-in.
for f in WString.h WString.cpp Print.h Print.cpp Stream.h Stream.cpp Printable.h pgmspace.h stdlib_noniso.h stdlib_noniso.c; do cp "$sources/arduino-esp32/cores/esp32/$f" "$here/work/core/"; done
flags="-std=gnu++17 -I $here/stubs -I $here/work/core -I $sources/ArduinoJson/src"
for f in WString Print Stream; do [ -f "$here/obj/$f.o" ] || g++ $flags -w -c "$here/work/core/$f.cpp" -o "$here/obj/$f.o"; done
[ -f "$here/obj/stdlib_noniso.o" ] || gcc -w -I "$here/stubs" -I "$here/work/core" -c "$here/work/core/stdlib_noniso.c" -o "$here/obj/stdlib_noniso.o"
[ "$here/obj/runtime.o" -nt "$here/runtime.cpp" ] || g++ $flags -Wall -Wno-unused -c "$here/runtime.cpp" -o "$here/obj/runtime.o"
work=$here/work/$1; rm -rf "$work"; mkdir -p "$work"; cp "$src"/* "$work"/
# The test configuration: a Wi-Fi name (so the link starts) and the local copy of the website.
sed -i 's/constexpr char WIFI_SSID\[\] = "CHANGE_ME";/constexpr char WIFI_SSID[] = "test-network";/; s/constexpr char WIFI_PASSWORD\[\] = "CHANGE_ME";/constexpr char WIFI_PASSWORD[] = "not-a-real-password";/; s/constexpr char CLOUD_HOST\[\] = "control.carla.codes";/constexpr char CLOUD_HOST[] = "127.0.0.1:'"$2"'";/' "$work/Config.h"
[ "$3" = practice ] && sed -i 's/constexpr bool PRACTICE_MODE = false;/constexpr bool PRACTICE_MODE = true;/' "$work/Config.h"
grep -q '127.0.0.1' "$work/Config.h" && grep -q 'test-network' "$work/Config.h"
g++ $flags -Wall -Wextra -Wno-unused-parameter -Wno-sign-compare -I "$work" -x c++ -c "$work/$ino" -o "$here/obj/$1.o"
g++ -o "$here/bin/$1${3:+-$3}" "$here/obj/$1.o" "$here"/obj/{runtime,WString,Print,Stream,stdlib_noniso}.o -lpthread
echo "built $1${3:+-$3}"
