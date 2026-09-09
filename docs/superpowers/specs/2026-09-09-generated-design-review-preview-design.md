# Generated design review preview

## Goal

Make the review screen show a complete garment and a clearly visible generated design before the customer adds it to cart.

## Design

- The result-stage garment remains centered at its natural scale, instead of using the editorial zoom that crops the neckline and sleeves.
- The garment image receives its own class. Only that image gets the full-stage sizing rules; the generated artwork remains an independent, absolutely positioned print layer.
- The print layer sits in the upper-centre chest area, above the garment image.
- The deterministic local provider produces a transparent SVG with a high-contrast, deterministic colour motif. It is a development placeholder only, but must remain visible on both light and dark garment colours.

## Validation

- Generate a black-shirt and a white-shirt preview locally.
- Confirm the full shirt and print layer are visible on the review step.
- Preserve the existing Add to cart and regeneration behaviour.
