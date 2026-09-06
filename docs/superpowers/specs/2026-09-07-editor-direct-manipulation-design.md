# Editor direct-manipulation controls

## Objective

Let customers manipulate the generated artwork directly on the shirt without relying on the control cards below the mockup.

## Selection behavior

- Tapping the artwork selects it and reveals a subtle selection frame.
- The selected state exposes four corner resize handles and one rotation handle above the artwork.
- Tapping outside the artwork and its handles clears the selection and hides the direct controls.
- Dragging the artwork itself continues to move it.
- The existing compact toolbar remains available as a discoverable and accessible fallback.

## Diagonal resize

- Each corner handle resizes from the diagonally opposite corner.
- Resize preserves the artwork aspect ratio.
- The gesture uses the pointer's diagonal distance from the fixed corner, so it works with finger, pen, and mouse input.
- The existing minimum, maximum, and print-boundary constraints remain authoritative.
- The complete resized artwork must remain inside the provider-derived print boundary.

## Free rotation

- The rotation handle sits above the artwork and is connected to the selection frame.
- Dragging it rotates freely around the artwork center through the full 360-degree range.
- The editor stores rotation in a normalized range from `-180` through `180` degrees.
- A small magnetic snap applies near `0`, `90`, `-90`, and `180` degrees while still allowing arbitrary angles elsewhere.
- The complete rotated artwork remains inside the print boundary; its center is constrained when needed.

## Gesture lifecycle and history

- Pointer capture keeps an active gesture attached to its handle even when the finger moves outside it.
- Moving, resizing, and rotation each create one Undo entry when the gesture ends, not one entry per pointer frame.
- Redo, Center, Flip, Preview, Scale, Rotate, and Reset continue to work.
- Starting a new transform clears Redo, matching the existing history behavior.

## Accessibility and feedback

- Resize and rotation handles are real buttons with descriptive accessible labels.
- Handles meet the minimum mobile touch-target size without making their visible dots visually heavy.
- The selection frame and connector do not intercept unrelated taps.
- Screen-reader status text announces selection, size percentage, and rotation angle after interaction.
- Reduced-motion settings continue to remove transform animation.

## Print-boundary distinction

The visible `DESIGN AREA` preserves the Monster Digital / Printify-derived front print-area aspect ratio. Its exact placement on the prototype garment and the conservative internal inset remain prototype implementation choices, not a published Monster Digital safe-zone guarantee.

## Verification

Verify with mouse and browser touch emulation:

1. Tap artwork to reveal handles.
2. Tap outside to hide them.
3. Drag each corner to resize proportionally in both directions.
4. Drag the rotation handle through arbitrary angles and the four magnetic angles.
5. Confirm rotated and resized bounds cannot leave the print area.
6. Confirm one Undo reverses one completed gesture and Redo restores it.
7. Confirm existing move, toolbar, preview, optional-editor, product, generation, and checkout-boundary behavior remains intact.

Run format, lint, typecheck, and production build after implementation. Physical-device validation must be reported separately and must not be claimed unless actually performed.
