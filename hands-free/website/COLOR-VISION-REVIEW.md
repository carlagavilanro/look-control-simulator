# Red–green color vision review

Reviewed September 29, 2026. Scope: current warm plum full room-control frontend, not the separate eye-tracking demo.

## Result

The inspected main controls remain distinguishable in lower-severity protanomaly/deuteranomaly simulations and full protanopia/deuteranopia simulations. The plum colors shift toward blue, but text, control boundaries, and the selected control's strong outline and explicit “In focus” text remain visible. This is a scoped design audit, not full WCAG certification or a guarantee of individual perception.

## Method and evidence

- Applied Machado model matrices from Colour Science's official implementation to linear sRGB values, clipping out-of-gamut channels. Browser preview uses SVG feColorMatrix with explicit linearRGB interpolation.
- Visually reviewed a static screenshot of the current frontend with enabled controls and a selected power button, active/completed calibration examples, and a partly filled dwell bar. This fixture sends no commands. The camera was off; no user images were captured or uploaded.
- Reprocessed the existing contrast audit: 227 text/background readings across the profile dialog, dashboard, enabled states, and mobile layout, plus 27 additional pairs. Repeated color pairs are included. Disabled controls were retained in the data but excluded from the required-text minimum.
- Severity 0.2 is a lower-severity sample in this model, not a clinical diagnosis or a percentage of vision lost. Severity 1.0 models dichromacy.
- Standard WCAG ratios are calculated on the original colors. Ratios after simulation are supplemental diagnostics, not a separate WCAG conformance test.

| View | Lowest simulated enabled-text ratio | Lowest ratio in additional-pair set | Below applicable reference threshold |
| --- | ---: | ---: | ---: |
| Original | 5.07:1 | 3.36:1 | 0 |
| Protanomaly, 0.2 | 5.05:1 | 3.37:1 | 0 |
| Deuteranomaly, 0.2 | 5.08:1 | 3.35:1 | 0 |
| Protanopia, 1.0 | 4.99:1 | 3.43:1 | 0 |
| Deuteranopia, 1.0 | 5.12:1 | 3.31:1 | 0 |

The additional-pair set includes both text and non-text pairs, each compared with its own existing reference threshold. Full values and matrices: COLOR-VISION-RESULTS.json. Visual comparison: ../color-vision-comparison.png. Standalone full-resolution source images and filters: ../color-vision-preview.html.

## Non-color cues and remaining recommendations

- **Selected remote button:** explicit “In focus” label, outlined boundary, and countdown text support the fill color. No red-versus-green distinction is required to identify the selected button.
- **Connection and direction:** accompanying text describes controller state and eye direction. The small colored dots should remain supplementary.
- **Dwell:** the progress bar changes length and has a numerical countdown in text during an actual hold; this does not require recognizing a hue.
- **Disabled controls:** dashed borders, readable labels, and connection status explain their unavailable state.
- **Calibration:** active/completed buttons use similar lavender fills. Separate status text describes the current step and most recently saved sample, but each completed button lacks a persistent written completion cue. Recommend a checkmark plus “Done” on each completed step and an “In progress” label on the active one.
- **Profile picker:** the selected option has a different background; the current name appears in the page header. Recommend an explicit “Current profile” badge inside the picker so users need not infer selection from its fill.
- **Eye overlay:** source uses mint #78ffe0 for valid tracking and amber #ffcf70 otherwise, with identical outline shapes. Nearby text describes tracking availability/uncertainty, so tracking status is not solely conveyed by color. Recommend a dark halo and distinct solid/dashed outlines to improve local visibility. Neither marker visibility over changing video nor actual live eye tracking was tested here; no single color can guarantee contrast against every camera image.

The production palette was updated to warm plum; application behavior is unchanged. User testing with people who have the relevant vision differences remains valuable.

References: [Colour Science Machado matrices](https://github.com/colour-science/colour/blob/develop/colour/blindness/datasets/machado2010.py), [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
