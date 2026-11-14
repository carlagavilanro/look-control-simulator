# Warm plum palette and contrast review — September 29, 2026

The full frontend uses warm plum and berry actions, lavender selection highlights, white cards, and a softly tinted background. Large labels, visible focus outlines, and the explicit “In focus” cue remain in place. Primary action hover colors now apply consistently to Start camera and Connect as well.

## Verification

- Browser-computed text/background contrast: 74 dashboard readings, 10 profile-dialog readings, 75 enabled/selected-state readings, and 68 readings at a 390-pixel mobile width. All passed applicable WCAG AA text contrast targets. Repeated pairs are included.
- 27 additional palette-pair checks passed their applicable text or non-text targets, covering placeholders, hover colors, borders, focus rings, icons, progress, selected profiles, and status colors.
- Primary button text: 7.88:1. Selected label: 9.36:1. “In focus”: 7.12:1. Placeholder: 8.76:1. Lowest checked required non-text pair: 3.36:1.
- No document-level horizontal overflow in the checked desktop, profile, enabled-control, or mobile states.
- Lower-severity and full protan/deutan simulations were regenerated and visually reviewed; see COLOR-VISION-REVIEW.md and COLOR-VISION-RESULTS.json.
- The running full website was refreshed. Verification used an isolated selected-state fixture; no appliance commands or camera recording were needed. Eye-control logic is unchanged.

## Scope

This is a scoped contrast review, not full WCAG or ADA certification. Live eye markers appear over variable camera imagery and are outside the static contrast results. System colors remain in charge in forced-colors mode. Previously recommended explicit calibration completion badges and a current-profile badge remain future improvements.

References: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
