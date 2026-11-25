#!/bin/sh
# Checks the website's ready-made Samsung TV buttons against the infrared library the boards use
# (IRremoteESP8266, with its own host-side test helpers): the library, asked to send each code
# twice, produces exactly the website's timings, and its receiver reads the website's timings back
# as SAMSUNG, 32 bits, the same code. Fetches the library the first time.
set -e
cd "$(dirname "$0")"
sources="${ARDUINO_SOURCES:-$PWD/sources}"; lib="$sources/IRremoteESP8266"
[ -d "$lib" ] || { mkdir -p "$sources"; git clone --quiet --depth 1 https://github.com/crankyoldgit/IRremoteESP8266 "$lib"; }
work=work/samsung-check; mkdir -p "$work/obj" bin
flags="-std=gnu++17 -O1 -w -DUNIT_TEST -D_IR_LOCALE_=en-AU -I$lib/src -I$lib/test"
for file in "$lib"/src/*.cpp; do object="$work/obj/$(basename "$file" .cpp).o"; [ -f "$object" ] || g++ $flags -c "$file" -o "$object"; done
g++ $flags samsung-check.cpp "$work"/obj/*.o -o bin/samsung-check
node -e "import('../../website/hub.mjs').then(({samsungTimings,READY})=>{for(const [,,code]of READY['samsung-tv'].buttons)console.log('0x'+code.toString(16).toUpperCase()+' '+samsungTimings(code).join(' '));})" | bin/samsung-check
