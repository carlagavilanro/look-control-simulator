# Guided setup and profile settings

Creating a profile opens a welcome screen, camera setup, automatic center/left/right calibration, a save confirmation, and a four-page website tour. Each direction has 2.5 seconds to prepare followed by 2.5 seconds of sampling. At least 20 valid frames per direction and the existing movement-quality checks are required before saving.

Profile contains **Edit calibration** and **Website tour**. Calibration controls are inside the setup dialog, not on the main page. A small setup prompt appears only when the active profile has no saved calibration or the active camera is incompatible. The camera preview remains available for ordinary use.

The tour covers selection and the five-second center hold, camera feedback and privacy, pause/stop, profile storage, fan functions, controller status, and the current limitations of TV/heater and other browser tabs. It does not send test appliance commands.

Closing setup preserves the previous saved calibration. Incomplete profiles resume setup or their unfinished tour next visit. Existing profiles with valid calibration are treated as previously onboarded. Local storage failures remain visible and never report a successful save. No raw eye samples, images, videos or access keys are added to profile storage.

Initial name entry, camera permission and wizard navigation can require a helper or mouse/touch/keyboard. The wizard does not claim to be independently navigable by eye before calibration.

Validation: 34 automated tests; browser integration with synthetic eye features through create → camera → three samples → save → four tour pages → reload → Profile → Edit calibration; text contrast checks on new screens, and narrow-screen layout review at 390 × 844. A real-person usability trial remains necessary for the timing and physical camera setup.
