> **Complete Hands Free project:** [source, setup and build instructions](hands-free/README.md)
> — Windows companion **0.4.39**, current eye tracking, website, ESP32 firmware,
> tests and bundled models. This repository's root folder keeps the original
> portfolio simulator described below.

# Look & Control — accessibility interaction simulator

[Try the live demo](https://carla.codes/demos/look-control/) · [Project story](https://carla.codes/#look-control)

Explore how a deliberate hold selects a command. Choose a fan action, hold the on-screen control or Space for five seconds, and watch a simulated device respond. Release early to cancel; try tracking loss and pause.

**This demo uses no camera and controls no real hardware.** Its dwell-selection module is extracted from Carla Gavilan's Look & Control prototype. The four fan controls and visual device are a new portfolio simulation, not a clinical evaluation or demonstration of wheelchair movement.

## Run and verify

Node.js 22 or newer; no packages to install.

```sh
npm start
npm test
```

Open `http://127.0.0.1:4174`. Fourteen automated tests cover eye/dwell selection, cancellation, tracking interruptions, one-shot dispatch, command validation, and speed bounds. GitHub Actions repeats the suite.

## Interaction contract

- Select a command using its button or the left/right arrow keys.
- Hold the large control, or focus it and hold Space. Releasing cancels progress.
- Five seconds of valid tracked input emits one command, then disarms.
- Missing tracking pauses progress briefly; an interruption beyond 700 ms resets it.
- Pause and loss of page focus cancel an unfinished hold.
- Speed is bounded to 1–3. Unknown commands are rejected.

The keyboard simulation represents selection intent; it does not estimate gaze. Actual eye tracking also needs calibration, user testing, and device validation.

## Architecture and contribution

`public/eye-selection.mjs` handles time-dependent selection. `public/device.mjs` is a pure device reducer. `public/app.mjs` connects browser inputs to those modules and renders an event trail. There is no camera upload, database, or remote command endpoint.

Carla's original prototype connects eye controls to a Node gateway and ESP32 infrared capture/replay. One fan speed-down command was verified on physical hardware during that work. This repository does not include a hardware video or claim that the simulation validates that connection. A useful next artifact is a real-device recording showing selection → gateway → fan.
