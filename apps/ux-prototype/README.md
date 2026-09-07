# Let It Be UX prototype v0.1

Disposable CEO/product-review prototype for the local mobile flow: **Step 1: Idea**, **Step 2: Style + Tone**, **Step 3: Color + Size**, **Step 4: Generated preview**, and **Step 5: Checkout**. Generation, checkout, and editor changes are local simulations only. The standalone Next.js application has no API routes, production-service imports, backend, persistence, provider connectivity, payment processing, order creation, or production data writes.

## Run

```bash
pnpm --filter @let-it-be/ux-prototype dev
```

The command binds to `0.0.0.0:3001`. Use `http://localhost:3001` locally, or replace `localhost` with the host machine's active private IPv4 address on the same Wi-Fi/LAN for phone testing.

## Prototype fixtures

`public/garments/classic-tee-{black,navy,white}.png` are generated, replaceable, local-only static fixtures used exclusively by this prototype. Step 1 uses White only as a neutral garment presentation—not a selected product color. Black, Navy, and White use dedicated images in the configurator. The remaining provider colors use the White fixture with an alpha-masked local tint treatment, so they are catalog-faithful selectors rather than production garment renders.

The optional reference image preview remains in browser memory through an object URL and is never uploaded or persisted.

## Step 2: Style + Tone

Step 2 is one mobile-first page. Consumers choose exactly one Style Family and may set an optional Tone (Auto is the default). The deterministic local Look resolver remains in state but its consumer-facing recommendation control is temporarily hidden while that direction is reviewed. It makes no AI request.

Theme A, Creative canvas, and Fade composer are fixed for review; consumer previews do not show variant or debug controls.

## Step 3: Comfort Colors 1717 configuration

Step 3 carries the local creative state forward and uses the locked Printify profile: Comfort Colors 1717 (blueprint `706`), Monster Digital (provider `29`), DTG, Front. Black is selected by default; Size requires a deliberate selection. The first eight colors are visible immediately and `+ more colors` expands the complete 33-color provider snapshot from 2026-09-06. Sizes are S–4XL. This is a static review fixture with no live Printify/API request.

The local availability snapshot marks `Blue Spruce + 4XL` and `Grey + 4XL` unavailable. Changing Color while one of those combinations is selected clears Size and explains why. `Create My Shirt` starts a simulated local generation state, then presents a local artwork preview. Color may inform future artwork palette decisions; Size is merchandise/availability context and is not a creative-prompt input.

The prototype base price remains `$39.99`. The review-only large-size surcharge fixtures remain `+$3` for 2XL, `+$5` for 3XL, and now `+$7` for 4XL; replace them when final commercial pricing is approved.

The displayed `1 credit` balance is a fixed, prototype-only guest fixture. It has no account lookup, billing effect, or backend connection.

## Optional placement editor

The generated-design review uses `Continue to checkout` as its primary CTA and exposes `Edit design` as an optional secondary action. Opening the editor preserves the selected garment, generated artwork, color, size, and price. The consumer sees only a simple `DESIGN AREA` outline. Provider, method, pixel dimensions, DPI, safe-area policy, and other production requirements remain internal and are never rendered in the customer UI. Behind that neutral presentation, the boundary preserves the provider-derived `7:8` proportions and scales down for M and S.

The design can be moved inside the outlined design area with a finger or mouse drag; keyboard users can nudge it with arrow keys, resize it with plus/minus, and reset it with `R`. Tapping the artwork reveals four proportional diagonal-resize handles and a rotation handle. The rotation handle supports arbitrary angles across the full 360-degree range, with light magnetic snapping at the principal angles. Tapping outside the artwork hides the handles. Every drag, nudge, resize, rotation, viewport resize, and garment-size change constrains the complete rotated design bounds to the internal safe area. Center-axis magnetic snapping provides visible alignment guides while moving the artwork.

The compact tool set provides Undo, Redo, Center, horizontal Flip, Preview, Scale, Rotate, and Reset. Undo/Redo record discrete control changes and completed drag gestures rather than every pointer frame. Preview temporarily removes the editor outline and controls, with a persistent `Back to editing` action. Placement and history remain browser-local only; `Save & continue` returns to the generated-design review with checkout as the primary next action. Reopening the optional editor preserves the current local placement.

The full provider research, exact dimensions, preflight rules, availability snapshot, sources, and reusable SVG master are in [`docs/printing/comfort-colors-1717-monster-digital-front-dtg.md`](../../docs/printing/comfort-colors-1717-monster-digital-front-dtg.md).

## Step 5: local checkout

Checkout is a one-page, mobile-first review flow with the product summary, contact and US delivery address fields, shipping choices, payment-form placeholders, and an estimated total. Its information hierarchy follows the familiar ecommerce checkout pattern, but the interface uses Let It Be copy, styling, and components; no Shopify branding, assets, or checkout code is used.

The static shipping fixtures are Economy (`$3.99`, 4–8 business days), Standard (`$4.75`, 2–5 business days, selected by default), and Priority (2–3 business days, calculated later). They are grounded in the current Printify/Monster Digital shipping rules but intentionally do not expose a provider or carrier to the shopper; fulfillment selects the carrier after ordering based on destination and availability.

`Review demo order` only shows an in-prototype confirmation. It does not submit contact details, process a card, calculate tax, create an order, reserve inventory, or call an external service. The payment section explicitly asks testers not to enter a real card number.

## Steps 1–3 copy and hierarchy

The approved visual direction is preserved. The repeated `Make it yours` eyebrow and non-essential introductory subtitles are removed so each step begins with one consumer-facing title and its primary interaction. The current title wording, low-emphasis progress treatment, and header/back-label treatment are intentionally not design-locked and remain open for later CEO review.
