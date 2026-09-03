# Let It Be UX prototype v0.1

Disposable CEO/product-review prototype for the three pre-generation steps: **Step 1: Idea**, **Step 2: Style + Tone**, and **Step 3: Color + Size**. The approved order is Idea → Style + Tone → Color/Size → Generate. Step 4 is a local boundary only; generation is not implemented. It is a standalone Next.js application with no API routes, production-service imports, backend, persistence, provider connectivity, or production data writes.

## Run

```bash
pnpm --filter @let-it-be/ux-prototype dev
```

The command binds to `0.0.0.0:3001`. Use `http://localhost:3001` locally, or replace `localhost` with the host machine's active private IPv4 address on the same Wi-Fi/LAN for phone testing.

## Prototype fixtures

`public/garments/classic-tee-{black,navy,white}.png` are generated, replaceable, local-only static fixtures used exclusively by this prototype. Step 1 uses White only as a neutral garment presentation—not a selected product color. They are not production garment rendering and may be removed with the application.

The optional reference image preview remains in browser memory through an object URL and is never uploaded or persisted.

## Step 2: Style + Tone

Step 2 is one mobile-first page. Consumers choose exactly one Style Family and may set an optional Tone (Auto is the default). The deterministic local Look resolver remains in state but its consumer-facing recommendation control is temporarily hidden while that direction is reviewed. It makes no AI request.

Theme A, Creative canvas, and Fade composer are fixed for review; consumer previews do not show variant or debug controls.

## Step 3: Color + Size

Step 3 carries the local creative state forward and adds a fixed `Classic T-Shirt` prototype fixture at `$39.99`. Black is selected by default; Size requires a deliberate selection. Popular color swatches are Black, White, Navy, Forest, and Burgundy, with a collapsed local-only More colors group. Black, White, and Navy use dedicated garment fixtures; the additional colors are explicitly replaceable visual treatments.

The local availability matrix contains one review case: `Navy + M` is unavailable. Changing from an eligible `M` selection to Navy clears Size, leaves M visible but disabled, and explains why. The Size Guide values are prototype fixtures only. `Create My Shirt ✦` stores no data and opens only the local Step 4 boundary; it makes no generation, payment, provider, or backend request. Color may inform future artwork palette decisions; Size is merchandise/availability context and is not a future creative-prompt input.

The displayed `1 credit` balance is a fixed, prototype-only guest fixture. It has no account lookup, billing effect, or backend connection.
