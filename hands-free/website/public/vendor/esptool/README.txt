esptool-js 0.7.1 (Espressif Systems, Apache License 2.0) and pako 2.1.0 (MIT and Zlib).
They put a program onto an ESP32 over USB from the browser (Web Serial). Used by boards.mjs.

Where these files come from
  esptool-js   https://github.com/espressif/esptool-js   commit d5b779b (the 0.7.1 release)
               src/**/*.ts compiled to JavaScript modules with the TypeScript compiler
               (target ES2022, module ESNext, no type checking). The chip helper programs in
               targets/stub_flasher/*.json are copied as they are.
  pako         https://github.com/nodeca/pako            tag 2.1.0, dist/pako.esm.mjs as it is

Changed here (two lines, so the files load in a browser with no build step)
  esploader.js     imports pako from "./pako.esm.mjs" (the published package imports "pako")
  stubFlasher.js   uses the browser's own atob (the published package imports "atob-lite")

Licences: LICENSE-esptool-js.txt, LICENSE-pako.txt, targets/stub_flasher/LICENSE-*.txt
