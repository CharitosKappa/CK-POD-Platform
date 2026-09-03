# UX Prototype — Step 3: Color + Size

## Scope

Implement only the final user-input step in `apps/ux-prototype`: `Idea → Style + Tone → Color + Size → Generate`. Step 3 is a full mobile page for a fixed `Classic T-Shirt` at `$39.99`; it does not add product selection, generation, network activity, production services, or writes.

## Consumer experience

The existing page shell, header, typography, spacing, card language, and CTA treatment remain intact. The page presents a large centered garment preview, then Color and Size as the two consumer choices. Black is the valid default Color. Size has no default and is required before `Create My Shirt ✦` can reach a local Step 4 boundary.

Popular color swatches are Black, White, Navy, Forest, and Burgundy. A collapsed More colors control reveals Sand, Heather, and Red. Black, White, and Navy reuse dedicated local garment fixtures; the remaining swatches are replaceable local visual treatments. The selected color name and a visible checkmark supplement the swatch color.

Sizes are S, M, L, XL, and 2XL. The deterministic local availability fixture makes Navy + M unavailable. If M is selected and the user changes Color to Navy, Size clears, M remains visible and disabled, and the page says `M isn’t available in Navy. Choose another size.` The user is never silently moved to a different Size. A bottom-sheet Size Guide exposes fixture measurements and a concise measuring instruction.

## State and boundaries

Step 3 preserves the existing local idea, optional reference fixture, Style, Tone, AI recommendation, manual Look override, and effective Look state. It adds local Product, Color, and Size state. Returning to Step 2 preserves these values; returning to Step 3 preserves the prior valid Color and Size.

Actual generation starts only after Step 3 in a future task. Color may influence future artwork palette/contrast decisions; Size is merchandise and availability context, not creative-prompt input. The current `Create My Shirt ✦` action opens only a local boundary message.

## Review notes

Theme A remains the locked consumer direction. The current consumer preview has no debug controls; the retained A/B/C token architecture and local state remain implementation details. The progress label `3 / 4` stays low emphasis and remains open for later UX review. Final colors, availability, and Size Guide data depend on qualified product/provider fixtures.
