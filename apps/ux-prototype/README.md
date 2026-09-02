# Let It Be UX prototype v0.1

Disposable CEO/product-review prototype for **Step 1: Idea** only. The approved pre-generation order is Idea → Style → Color/Size → Generate; Steps 2–4 are not implemented. It is a standalone Next.js application with no API routes, production-service imports, backend, persistence, provider connectivity, or production data writes.

## Run

```bash
pnpm --filter @let-it-be/ux-prototype dev
```

The command binds to `0.0.0.0:3001`. Use `http://localhost:3001` locally, or replace `localhost` with the host machine's active private IPv4 address on the same Wi-Fi/LAN for phone testing.

## Prototype fixtures

`public/garments/classic-tee-{black,navy,white}.png` are generated, replaceable, local-only static fixtures used exclusively by this prototype. Step 1 uses White only as a neutral garment presentation—not a selected product color. They are not production garment rendering and may be removed with the application.

The optional reference image preview remains in browser memory through an object URL and is never uploaded or persisted.
