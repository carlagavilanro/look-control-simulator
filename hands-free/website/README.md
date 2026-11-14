# Look & Control

A browser-based front-camera prototype for controlling a fan and a TV through your ESP32. It works inside the website and does not depend on Android accessibility features. Camera permission and initial calibration are required.

## Cloud website

The Railway deployment uses `cloud-server.mjs` and the included Dockerfile. It has a username/password sign-in and works without a connected ESP32. Camera processing and calibration stay local to the browser; appliance commands remain disabled until a cloud-to-controller connection is implemented. The existing `server.mjs` remains the LAN gateway. See [Railway deployment details](RAILWAY-DEPLOYMENT.md) for environment variables, session behavior, and hosting settings. Preparing these files does not by itself mean the website has been deployed.

## What is implemented

- Front camera preview and local MediaPipe Face Landmarker processing in a worker. Live eye outlines and pupil rings overlay the mirrored preview; calibrated left/center/right feedback and a bright selected-button outline make tracking visible. Stale frames clear the eye overlay.
- Three-position calibration: center, left, right. This is gesture selection, not a precise screen-position eye tracker.
- New profiles open guided setup: camera permission, automatic center/left/right samples, saved-calibration confirmation, then a four-page tour. After setup, calibration controls are available through Profile → Edit calibration; Profile → Website tour replays the introduction. The main dashboard only shows a setup prompt when calibration is missing or incompatible with the active camera.
- Look left for the previous control or right for the next, then hold center for 5 seconds to send the highlighted command once. There is no second confirmation. A visible countdown and progress bar show the hold. Navigate again before sending another eye-controlled command. Mouse/touch clicks send directly.
- A selectable Pause control; while paused, look left or right and then hold center for 5 seconds to resume.
- Brief eye-landmark loss (up to 700 ms) pauses a hold without counting missing time. Longer loss or stalled frames reset the five-second timer but preserve the selected button. Looking away resets the timer. Camera stop, recalibration, Pause and hiding the page clear active holds. Poor calibration prevents eye selection.
- Website → authenticated local gateway → ESP32 Wi-Fi command endpoint → captured fan IR signal.
- No camera uploads or recordings. Frames are processed on the device and discarded. Named profiles optionally save six calibration values and camera settings in this browser’s local storage. Access keys are never saved with profiles.
- A redesigned responsive dashboard with locally bundled Manrope fonts, device cards, outlined icons, a prominent focus timer, and named-profile setup.

Seven fan captures are included. Seven TV controls are implemented but remain unavailable until their real remote signals are captured and uploaded. Use the Fan and TV device cards, or the eye-selectable Switch to TV / Switch to fan button. No TV captures are included. Heater actions remain disabled. The original appliance mode controls this website. The separate Windows screen-control mode is described below.

## Run on this laptop

Node.js is required. Model and runtime assets are bundled under public/vendor; normal startup does not download the model.

1. Copy config.example.json to config.local.json and fill in the ESP32 address, its control token, and a separate random website access key of at least 24 characters. Keep the populated file private.
2. Run `node server.mjs` from this folder.
3. Open http://localhost:8787 on the same laptop, enter the website access key and select Connect.
4. Select Start camera and allow access. Close other apps using the camera if necessary.
5. Create a named profile and follow guided setup. Select Start camera, then Start calibration when eye analysis is ready. Follow the center, left and right instructions; the steps advance automatically and save only after validation. Continue through the website tour. A helper can assist with profile entry and setup buttons. Failed samples can be retried; canceling recalibration preserves the previous saved setup.
   On later visits your last profile is selected automatically. Start the same camera to restore its calibration. Switch people through the profile button; switching stops the camera and clears active holds. A different camera/resolution or a changed head/camera position may require calibration again.
6. Use left/right eye gestures to move, then hold center for 5 seconds to send the highlighted command once. Test with the actual person in their normal lighting and posture before relying on it.

This package contains example settings only. Create your own private configuration; no working keys or Wi-Fi passwords are included.

## Use a different laptop or tablet

A camera-enabled browser needs a secure context. `localhost` works only on the computer running the gateway. Opening an ordinary HTTP LAN address on another device does not grant camera access.

For a tablet, serve this website through a trusted HTTPS reverse proxy or a properly authenticated HTTPS tunnel to the gateway. Do not bypass certificate warnings. Keep the ESP32 private on the LAN; only the gateway talks to its HTTP API. Camera video remains in the tablet browser even when the web interface is served through HTTPS. HTTPS hosting for a separate device is not configured in this package.

The gateway binds to loopback by default. Keep this default for laptop use or a local reverse proxy. Do not expose it publicly with the temporary local test key. Use a fresh secret and the intended network access controls for remote operation.

## Profiles and privacy

Profiles are local presets, not password-protected accounts or cloud logins. They belong to this browser and website address; localhost and 127.0.0.1 have separate storage. Clearing site data removes profiles. Camera hardware identity, resolution, six numerical calibration values, the chosen name, save time and onboarding completion are retained. No face images, raw landmark sets, video, controller keys or website keys are saved. Remove a profile with the profile picker’s Remove current profile button. Guest use supports manual controls; create a profile for guided eye calibration. Saved calibration alone never arms a command. Setup and profile dialogs cancel active holds and block appliance activation. Incomplete setup resumes on the next visit; previously calibrated legacy profiles are not forced through onboarding.

## Validation status

The current TV/fan extension passed 39 website tests and eight signal-file tests. The revised transmitter compiled for ESP32 (1,004,932 bytes flash; 47,504 bytes global RAM). It has not been flashed or deployed. TV behavior was tested with a mock controller, not a physical TV. See the root `validation/` folder and `TV-CONTROLS.md`. The following historical hardware observations used the earlier combined-board firmware, not a newly flashed separate transmitter.


Verified on the development computer:

- Practice and live ESP32 sketches compile with ESP32 core 3.3.11 and the installed IRremoteESP8266 library reporting 2.9.0. The installed IRrecv source includes ESP32 core 3 timer compatibility code.
- Practice and live firmware uploaded to the ESP32-D0WD-V3 on COM3. GPIO 15 receives; GPIO 4 transmits.
- Real ESP32 practice API accepted all seven fan actions, rejected bad authentication, malformed IDs, foreign origins, unknown/heater commands, duplicate IDs and rapid repeat commands.
- Browser simulation verified each button's request mapping, rejected-token feedback, pause/resume and lost-connection handling.
- The new website connected through the gateway to the real ESP32 and received an IR-send acknowledgement after confirming Speed down.
- The current revision passes 39 automated website tests, including profile persistence, camera matching, isolation between profiles, invalid/blocked storage, restoration without arming a command, guided setup and tour completion, retries, interrupted onboarding, legacy profile migration, and dialog command blocking. Existing checks cover gesture logic, exact five-second timing, brief and prolonged tracking loss, excluded missing-frame time, no repeat sends, direct mouse/touch activation, and one-hold Power toggle sending through a simulated command endpoint.
- An isolated browser fixture completed onboarding with synthetic eye samples, saved calibration, toured all four pages, reloaded without prompting again, and opened recalibration from Profile. This checks UI integration, not real-person eye-tracking accuracy. New camera/tour/profile text was checked against WCAG AA contrast thresholds, including a 390-pixel viewport without horizontal overflow.
- The actual browser worker loaded the model and returned no eye features for an empty frame. Two model-loading errors found during testing were fixed.

The user confirmed that the repeated website Speed down test physically worked on the fan. This verifies the website → gateway → Wi-Fi → ESP32 → IR → fan path for that command.

Still to verify: usable front-camera calibration and eye-driven selection with a person; accuracy/fatigue across realistic conditions; the other six physical fan actions; operation from a second device over HTTPS. The front camera is now working, eye-marker alignment was visually checked on a person, and the prior gesture calibration reported success. The user reports that the controls are now working overall. The redesigned interface and saved-profile restoration still need a returning-person eye-control trial. Do not describe these pending checks as passed.

Run logic tests with `node --test test/*.test.mjs`. These are not a replacement for a person using the camera and observing the fan.

## Sources and bundled assets

- Manrope font weights 400–800 from Google Fonts, bundled locally with the SIL Open Font License under public/vendor/Manrope-OFL.txt. No font network requests are made by the running website.

- MediaPipe tasks-vision 1.0.1 from the official npm package, with local WebAssembly runtimes.
- Google Face Landmarker model, float16 version 1, from https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Model SHA-256: 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
- [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [Browser camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

The local eye-feature and gesture heuristics are an experimental implementation. MediaPipe landmarks by themselves are not screen gaze coordinates. Frame rate, lighting, glasses, head position and individual eye movement affect usability.


## Windows screen control

### Fixation handling — version 0.4.2

Brief returning gaze excursions no longer immediately pull a held pointer away. A large movement needs at least three samples spanning 120 ms before the hold releases; sustained movement and small deliberate corrections remain possible. Slow changes update the anchor gradually instead of periodically jumping. Preview and controls use the same map eligibility rules: failed maps are included only in explicit test mode, or in a preview when no passing map exists.

A fluctuation inside the same button can pause the one-second selection timer for up to 120 ms. Paused time does not count, and a pause cannot trigger a selection. The latest raw estimate and displayed estimate must both remain in the target. Leaving it, losing tracking, or sustained instability resets progress. The latest sample must pass the fixation gate; an isolated older outlier no longer blocks the entire recent window. An already selected key stays locked until gaze leaves it.

These are interaction heuristics, not a physiological microsaccade detector. Ordinary webcam samples cannot establish whether a jump came from microsaccades, landmark noise, glasses, lighting, head movement, or mapping error. Filtering does not repair a systematic offset. Calibration and the seven accuracy checks still use original estimates, including finite rejected estimates. Saved models, the 15-position bank, and interpolation are unchanged. Copy tracking report compares raw/display intersample RMS movement and counts held excursions; these are stability diagnostics, not accuracy or microsaccade counts.

Regression tests cover 15/28/60 fps, small and large intentional movements, slow pursuit, returning excursions, lost tracking and selection timing. A controlled synthetic trace with small noise and 90 ms returning excursions reduced displayed 90th-percentile scatter at 28 fps from about 10.0 to 0.9 px. That is a simulation result, not measured improvement on a person. Large sustained simulated moves reached their new location within 250 ms. User testing with the existing camera is still required.

#### Research used and its limits

- Chaudhary, A. K., & Pelz, J. B. (2019). *Motion tracking of iris features to detect small eye movements*. Journal of Eye Movement Research, 12(6). https://doi.org/10.16910/jemr.12.6.4 — [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7962675/). Informed robust multi-sample treatment and the distinction between measurement noise and eye movement. Their 96 fps camera, infrared illumination and iris-texture method differ from this webcam/MediaPipe system; that method has not been implemented here.
- Nyström, M., Niehorster, D. C., Andersson, R., & Hooge, I. (2021). *The Tobii Pro Spectrum: A useful tool for studying microsaccades?* Behavior Research Methods, 53, 335–353. https://doi.org/10.3758/s13428-020-01430-3 — [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7880983/). Motivated reporting intersample movement separately from spatial scatter and distinguishing filtered display data from original estimates. Their specialized high-rate trackers do not establish microsaccade detection at this app's camera rate.
- Munz, T., Chuang, L., Pannasch, S., & Weiskopf, D. (2019). *VisME: Visual Microsaccades Explorer*. Journal of Eye Movement Research, 12(6). https://doi.org/10.16910/jemr.12.6.5 — [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7962676/). Informed explicit filter parameters and comparison of original and displayed movement. Their event-classification thresholds were not transferred to webcam samples; our 120 ms and pixel limits are engineering choices tested for pointer interaction.
- Ivanov, P., & Blanche, T. (2012). *Improving gaze accuracy and predicting fixation onset with video based eye trackers* [Author-hosted manuscript]. https://pirsquared.org/jov.pdf — Discusses pupil-related gaze artifacts and fixation prediction. The supplied [JOV publisher page](https://jov.arvojournals.org/article.aspx?articleid=2121538) was inaccessible; the related manuscript was reviewed instead. No pupil-size correction was added: MediaPipe iris landmarks do not provide the validated pupil-size measurements used in that work.
- Hume, T. (2017, November 10). *Eye tracking mouse control ideas*. https://thume.ca/2017/11/10/eye-tracking-mouse-control-ideas/ — Supports exploring coarse gaze plus enlargement for small targets. The existing region zoom remains available. This is a design essay, not validation of our filter, and automatic target snapping was not added.
- Perkins, L. E. (2025). *Role of eye-tracking technology and software algorithms in enhancing ADHD detection and diagnosis: A systematic literature review* [Honors thesis, Georgia Southern University]. https://digitalcommons.georgiasouthern.edu/honors-theses/1042/ — Only the official landing-page abstract could be reviewed; the supplied PDF was blocked. This clinical review was not treated as evidence for a pointer algorithm or a diagnostic capability.

Open Screen in the navigation or /screen. This includes browser practice and a downloadable Windows companion. The companion runs MediaPipe locally. Detailed setup uses 25 screen locations plus two center repeats; shorter setup uses 13 locations plus two center repeats. Seven separate points check accuracy. Controls use a one-second gaze hold for the keyboard, Google/YouTube search, scrolling, browser keys and region zoom for clicking the primary display. Saved calibration resumes on the same camera and display. Screen calibration is separate from the appliance profile.

Version 0.4.1 extends **Head positions** to 15 saved maps and estimates between nearby poses. The existing map is Position 1. Add positions with five fresh eye-only anchors and seven independent checks each. Pose features (face x/y, log apparent scale, roll, and available yaw/pitch) choose nonnegative weights that sum to one. A local convex fit combines each map's unclipped gaze prediction, not its coefficients, since the maps may use different bases. Each source is evaluated at its own pose reference plus the small unrepresented pose residual, keeping the actual eye readings. This avoids extrapolating a learned local head correction across the entire bank on top of interpolation. The fit favors nearby anchors and rejects large gaps and poses outside the local span. It does not use the gaze target to select weights or invent a passing accuracy result for the interpolation.

Normal control uses only individually passing positions; explicit Test saved positions can include unverified maps without changing their results. Continuous movement across map boundaries keeps the same pointer filter and selection countdown. Tracking loss, abrupt pose changes and long frame gaps require stable reacquisition and clear partial dwell without unlocking an already selected key. Looking away never deletes saved maps. One-second selection and the original eye validity checks remain in place.

Check accuracy, when using multiple saved positions, measures the combined mapping with seven fresh target fixations and does not alter any position's map or check results. Checks immediately following a new position or a repair still measure that single map. Numerical models and check summaries persist locally; no images, video or raw eye samples are saved. Camera/display compatibility remains required. Automated synthetic tests cover unseen intermediate poses, two-dimensional coverage, depth/rotation, unsupported ranges, continuous control, lost-tracking recovery, independent verification, cancellation and 15-position persistence. Synthetic accuracy is not a measured human result.

The browser by itself cannot inject input into other apps. The companion uses Electron and a restricted Win32 input helper. No internet-facing input service is opened. Its renderer is sandboxed, uses local assets, and can only request a fixed set of commands. Native input requires an armed session and fresh valid eye tracking. Escape and Ctrl+Alt+P pause; Ctrl+Alt+Q exits. Camera frames, temporary screen snapshots and text are not uploaded or written to disk. Numeric calibration and its camera/display fingerprint are stored locally. Version 0.2.1 saves the fitted model before verification, opens controls automatically after a passing check, and maintains a native calibration file with a recovery copy in the companion user-data folder. Failed checks offer a check-only retry. Fixed Google/YouTube shortcuts also work with a mouse while eye control is off; arbitrary Windows input remains gated.

This is a development prototype. Automated checks use synthetic gaze, not measured human gaze. Ordinary webcam accuracy depends on the person, position and lighting. Small targets use multiple zoom selections; direct pixel-accurate gaze, extra monitors, right/double click, dragging and elevated/secure Windows screens are not supported. See ../desktop-control/START-HERE.txt.

### Screen calibration version 2

Screen control now fits robust point centers and selects the model using leave-one-target-out checks on separate fixation groups. Each held-out target is scored using its 75th-percentile frame error, so eye weighting responds to jitter as well as bias. Candidate maps are affine or quadratic with ridge regularization (0.002, 0.02, 0.2); camera-left landmark-group weights are 0.25, 0.5, 0.75. Comparable candidates favor the affine map and equal eye weights. No head-motion correction is learned from gaze targets because correlated head and eye motion can produce a misleading fit; translation, scale, roll and face-relative nose position instead gate predictions. These thresholds are prototype heuristics, not human-validated limits.

Seven different locations then independently measure mean, maximum and 90th-percentile frame error, including per-target valid fraction. Validation points do not train or select the model. Passing requires mean normalized error <= 0.07, overall p90 <= 0.12, every target p90 <= 0.15 and at least 85% usable predicted samples at each target. The check uses raw estimates, not the smoother. Numeric results are saved; camera frames and landmark sample histories are not saved.

A median prefilter plus a One Euro adaptive filter reduces visible jitter. A separate 220 ms fixation gate and agreement between raw and filtered target selection prevent a trailing smoothed cursor from finishing an old dwell during a saccade. A measured error envelope creates target-boundary exclusion margins. Responsive layouts use fewer columns/rows and paged actions. The Back button grows with the measured error so gaze-based undo remains reachable; the grid and snapshot give it matching space. Pixel error values in the check are CSS coordinates; final zoom dimensions use physical display pixels. Zoom regions and snapshots share the same unobstructed area, and zoom continues until a region is <=12 physical display pixels in both dimensions. This geometry is not a claim of 12-pixel gaze accuracy.

Saved version 1 models require recalibration. Version 2 profiles retain the camera/display fingerprint and are checked each session. The existing appliance control calibration is unchanged.

Algorithm references: [One Euro filter, original authors](https://github.com/casiez/OneEuroFilter), [Google MediaPipe Iris documentation and gaze limitation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/iris.md).

### Accuracy and guided head positions — version 0.4.3

Calibration regression now uses target-balanced individual frame observations rather than fitting only the target medians. The target summary rejects isolated head-feature outliers. A point must settle in pose as well as iris coordinates. Existing saved models still load.

New calibrations and five-/nine-point repairs retain target coordinates and median numerical eye/head reference features. Images and per-frame histories are not retained. With at least two positions sharing four or more reference targets, the app can learn head-induced iris changes by comparing the SAME target across positions. A regularized pooled eye map is used only when whole-target cross-validation across all poses improves the independently refitted local affine baseline by at least 15%, by more than 0.002 normalized error, with worst held-out p90 <= 0.15. The seven check targets never fit or select this model. Eligibility and local pose support still apply. Older positions participate in the existing interpolation until their five-point updates provide summaries. Because the original full grid and five-point pattern share only the center, the pooled comparison normally needs two additional five-point position captures.

The head-position guide uses greedy information gain in normalized face x/y, log distance, roll and available yaw/pitch. It proposes directions least represented by the actual saved poses. The candidate set includes both signs of all six axes and two combined translation/depth positions. At most fifteen positions are retained. This is a bounded experimental-design heuristic, not a guarantee of accuracy throughout every physical head pose. Yaw/pitch are landmark ratios, not anatomical angles. The tilt drawing uses relative image-plane roll, approximately five degrees at the default step. The default normalized step is 0.75, reducible to 0.4. Version 0.4.7 replaces the original exact-match capture gate as described below. Skip, smaller movement and manual capture are available. Actual measured poses, not the ideal diagram targets, are saved.

### Head-position capture and intermediate estimates — version 0.4.7

The suggested pose is a direction, not an exact six-dimensional target. Head turns naturally change translation, apparent size and other ratios together. Automatic capture accepts 45–180% of the requested movement along its intended axes, while allowing bounded coupled motion. A 700 ms rolling median measures head stability separately from eye availability. After at least 550 ms of stable samples, another 450 ms of steady alignment starts five-point collection automatically. A blink up to 200 ms pauses rather than completes the hold. Missing eyes, stale frames and duplicate poses cannot auto-start. The explicit Capture this position button does not require a diagram match; the point collector still settles and checks samples. The front and side drawings use matching oval sizes, and head feedback can remain visible while the iris sample is unavailable.

Nearby-map interpolation now tolerates small measurement errors across multiple head axes: total normalized residual <= 0.5 and each axis <= 0.25. Large unmeasured gaps remain unsupported. For banks with at least three numerical reference sets, shared correction is also compared by leaving entire head positions out of training. A correction can be selected if its held-out-pose error improves by at least 15% plus a 0.002 normalized margin, while independent-target performance remains bounded. This catches failures that a perfect fit at each existing pose can conceal. The seven accuracy checks remain separate and are never used to train this correction. Existing position validation results are preserved; intermediate poses do not inherit a newly passed accuracy check.

Automated tests cover naturally coupled poses, automatic five-point capture, manual capture, saved-map persistence, missing eyes, stale frames, intermediate pointing and unsupported rotations. These simulations verify software behavior, not the user's physical gaze accuracy. Camera images and video remain on the device; saved calibration contains numerical summaries only.

### Compact keyboard and interactive page targets — version 0.4.8

Version 0.4.10 restores compact typing once when upgrading from the old saved size preference. The character grid no longer includes the easily hit Larger keys action. Size changes are under Text options, and grouped typing exposes a Compact keyboard button directly in the composer. This returns in one selection without clearing the draft. A deliberate later size choice remains saved. The migration changes only two keyboard preference keys; camera and calibration data are retained.

The default keyboard shows all letters in a responsive grid instead of nested letter groups. Numeric/symbol and case controls stay on the keyboard. Larger keys restores grouped typing, and Text options offers Full keyboard to switch back. This is a layout preference, not an assertion that a calibration passed. Existing accuracy, tracking-loss, head-support and explicit-test-mode gates remain in effect. Compact controls use a small interior hit margin; raw gaze must still support the target, and ambiguous neighboring keys are not automatically resolved. Typing does not rebuild or relocate the keyboard after every letter. The 600 ms dwell and look-away release remain unchanged.

Browse & scroll can select actual interactive items near gaze rather than forcing a precise mouse location or requiring a Tab button. A separate local Windows UI Automation helper enumerates up to 200 visible, enabled keyboard-focusable buttons, links, editable fields and related control types in the current app window. Password fields and ordinary paragraph text are excluded. Names and bounds are transient local data; they are not logged, saved to calibration, or uploaded. The renderer excludes rectangles covered by its own controls and resolves only a uniquely nearby candidate supported by both raw and displayed gaze. After the dwell, the native helper rechecks app identity, freshness, bounds, visibility and enabled state, sets keyboard focus, and invokes the control's supported action pattern. A focused Edit opens the companion's keyboard. Enter is a bounded fallback for focusable controls without an action pattern. This uses the focusable-control model that makes Tab navigation useful; it does not blindly issue repeated Tab presses or equate ordinary text with a clickable item.

The helper has its own process and timeout, so an unresponsive accessibility provider cannot block the existing keyboard/mouse helper. Not every app or custom webpage exposes usable controls; region click remains available. The provider may take a second query to expose a browser's page contents. Cached identities are scoped to the current app/helper generation, moved targets are rejected, and a spatial look-away guard prevents a changed page from immediately triggering another control at the same spot. Browser-only mode demonstrates this behavior on local practice controls; the Windows companion is required for other apps.

Tests cover four compact keyboard sizes, gaze typing without duplicate held-key entry, nearby/ambiguous page targets, text-field handoff, and real Windows accessibility against an isolated Edge page (link invocation, button invocation, field focus, and stale/moved-target rejection). These tests do not establish the user's physical small-key accuracy. API basis: [Microsoft: obtaining UI Automation elements](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/obtaining-ui-automation-elements) and [control patterns](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/control-pattern-mapping-for-ui-automation-clients).

Abrupt pose frames pause selection. Returning to the previous pose within 300 ms requires three coherent readings spanning at least 80 ms before resuming the existing pointer filter. A sustained new pose uses the 400 ms reacquisition gate. Partial dwell cannot complete during rejected frames. Existing median, fixation hold and adaptive One Euro filtering remain shared between preview and controls.

More controls offers Quick alignment with one fresh center fixation. It measures a bounded screen offset and then runs the seven independent checks. It does not infer the intended target from an automatic gaze click or train on the pointer's own selections. A larger/spatially varying error still needs a five-point repair or nine-point refinement.

Research informed these engineering choices rather than supplying commercial tracker internals. [Google's few-shot personalization research](https://research.google/pubs/on-device-few-shot-personalization-for-real-time-gaze-estimation/) motivates efficient individual calibration. [Microsoft's study of everyday gaze input](https://www.microsoft.com/en-us/research/publication/toward-everyday-gaze-input-accuracy-precision-eye-tracking-implications-design/) motivates separate regional accuracy/precision measurement and filter evaluation. [Tobii's accuracy and precision explanation](https://help.tobii.com/hc/en-us/articles/213534825-Let-s-talk-accuracy-and-precision) distinguishes systematic offset from scatter. The original [One Euro filter](https://gery.casiez.net/1euro/) addresses the jitter/lag tradeoff. The new pooled regression and guide thresholds are this prototype's implementation, not a reproduction of those companies' proprietary systems. Automated results use simulated gaze. Human error must be measured with a fresh seven-point check.

Version 0.4.11 makes everyday task, typing-option and settings menus compact. More controls exposes the common navigation keys directly. Panels use fixed-height buttons and paginate when vertical space is limited; screen-region zoom and the optional grouped keyboard keep their existing layout. Gaze mapping, dwell time and saved calibrations are unchanged.
