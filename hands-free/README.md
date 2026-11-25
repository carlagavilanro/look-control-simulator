# Hands Free

Current Windows companion: **0.4.42**.

Hands Free combines local camera-based eye control, a Windows desktop companion,
and separate ESP32 infrared receiver/transmitter firmware. The complete source,
tests, build scripts, camera models, browser runtime and font assets are here.

## Windows screen control

Install Node.js **22.12 or newer** on Windows, then run:

```powershell
cd desktop-control
npm ci
npm start
```

The first start/build downloads the pinned Electron runtime through `npm run
setup`; later starts reuse it. The companion loads its interface from the sibling
`website/public` folder.
It processes camera frames locally. It supports:

- **Face + eyes** follows the face in a square of camera pixels, so it works at
  a distance without zooming in until the face is cut; each frame also carries
  an iris reading taken from the camera's own pixels, and calibration keeps
  whichever reading predicts held-out screen points better.
- Reflections over an iris (glasses) are measured; one covered eye is filled in
  from the other. Camera preview can set the camera's brightness for the eyes.
- Normal **Face + eyes** tracking and a separate **Eyes close-up** tracker for
  zoomed-in views. Close-up mode finds both eyes by itself, follows them, and
  finds them again after a movement; a whole face is not needed and nothing has
  to be clicked. Each mode has its own calibration and accuracy check.
- Camera selection, explicit 4K/1080p/720p capture, supported zoom and frame crop,
  and direct wide-angle/telephoto switching for the EMEET C60E 4K Dual.
- Saved calibration and measured head-position maps in Face + eyes mode,
  supported interpolation, return guidance and fixation-aware selection.
- A compact bottom keyboard, three local English word suggestions, common-typo
  correction, Undo, separate session drafts and a hide-keyboard control.
- Windows typing, keyboard actions, scrolling, app-control targeting, pointer
  testing, and a reading mode. Selection uses a 0.6-second dwell with release.

Eye-position accuracy must be checked with the actual user and camera. Synthetic
tests and image-model tests do not establish accuracy for a person. The close-up
tracker tests run the bundled iris model on a drawn eye scene; they cover
framing, loss and recovery only. Face-angle
guidance is unavailable in Eyes close-up mode. Unsupported or lost tracking pauses
input. Escape pauses the companion. Saved calibration is kept in the Windows user
profile, outside this repository; video and eye images are not saved or uploaded.

## Build the Windows download

```powershell
cd desktop-control
npm ci
npm run package
cd ..
python tools/package-windows.py
```

Python 3.10+ packages the built app into
`website/public/downloads/Hands-Free-Screen-Control-Windows.zip`. The unpacked
build is placed beside this source folder as `Hands-Free-Screen-Control-Windows`.
Generated binaries, installed dependencies and downloads are excluded from Git.
The bundled inference models and their notices are included in the source.

## Website and ESP32 firmware

The LAN gateway uses `website/server.mjs`. Copy `website/config.example.json` to
`website/config.local.json` and fill it in locally, following
[the website guide](website/README.md). The browser screen-control practice route
is `/screen`; Windows control of other apps needs the companion.

The hosted login server is `website/cloud-server.mjs`; see
[Railway instructions](website/RAILWAY-DEPLOYMENT.md). Uploading this source to
GitHub does not itself deploy the site or connect a cloud server to home hardware.

See [the firmware guide](hardware/README.md) and
[automatic capture](hardware/AUTO-CAPTURE.md): receiver input is GPIO 15 and
transmitter output is GPIO 4. The receiver stores captures in its flash; the
transmitter replays its own uploaded signal library. Configuration headers contain
example credentials and the transmitter defaults to practice mode. Do not commit
real Wi-Fi credentials, access tokens or personal capture logs.

## Tests

From this folder, after building the Windows download:

```powershell
node --test website/test/*.test.mjs
node --test desktop-control/test/*.test.mjs
node --test hardware/test/*.test.mjs
```

The website suite includes authenticated download-route checks, so it requires the
generated ZIP. GitHub Actions builds it first. The test suites use synthetic inputs
and mock controllers; they do not flash hardware or send appliance commands.

## Repository contents

- `desktop-control/`: Electron companion, Windows input/accessibility helpers,
  calibration storage, packaging and tests. [Release notes](desktop-control/START-HERE.txt).
- `website/`: current shared interface/tracker, appliance interface, local/cloud
  servers, deployment configuration and tests.
- `website/public/vendor/`: local model/runtime assets, English dictionary and
  third-party license/attribution notices.
- `hardware/`: receiver/transmitter firmware, signal library, capture/upload tools
  and tests.
- `tools/`: reproducible Windows archive packaging.
- `validation/` and [midterm source notes](MIDTERM-SOURCE-NOTES.md): historical
  verification records, dated to their original versions.

The older mouse/keyboard portfolio simulator remains at the repository root.
Its five-second simulated hold is separate from the current companion's dwell.
