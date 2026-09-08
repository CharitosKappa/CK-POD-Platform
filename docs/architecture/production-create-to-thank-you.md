# Production Create-to-Thank-You Journey

## Goal

Move the approved mobile primary purchase journey from `apps/ux-prototype` into `apps/web` without changing its visual design. The production journey runs from Step 1 through thank-you with persistent backend state. It uses the existing deterministic local artwork generator; no external AI provider, payment processor, or fulfillment provider is enabled.

`apps/ux-prototype` remains the visual source of truth. Its primary purchase screens are reproduced in `apps/web`; business behavior is supplied by API routes and domain services rather than prototype-only client state.

## Scope

### Slice 1 — Create: Steps 1–3

- Create and retain a guest-owned project before the visitor begins the creation journey.
- Persist the creation prompt, optional reference-image asset, selected style and tone, color, size, and selection revision.
- Resolve the prototype's style-and-tone choices through an explicit server-owned semantic mapping to the existing style-family/preset contract. The mapping is per style, never a global ordinal tone-to-preset resolver; automatic selection uses deterministic idea keywords and rules rather than a prompt hash.
- Preserve the approved mobile transitions, scrolling, validation feedback, controls, and navigation between Steps 1–3.
- Give each newly created guest credit account five development design credits. A credit account migrated to a verified passwordless account remains the same account and balance.
- Use the same five-credit initial grant for any newly created authenticated account path.

### Slice 2 — Review and cart

- Submitting a valid creation request starts the existing deterministic local generation pipeline, shows its real lifecycle state, and displays its private preview.
- A validated completed local generation consumes exactly one design credit through the existing ledger, matching future real-provider behavior.
- Run the existing prepress and mockup path before cart creation. A cart item is created only from the project version and product configuration that passed the existing commerce checks.
- Port the approved review, add-to-cart, cart quantity, remove-item, and create-another-design interactions. Cart contents persist for the active guest or authenticated session.

### Slice 3 — Checkout and thank-you

- Port the approved checkout and thank-you presentation without the prototype-only messages.
- Use the existing address, shipping estimate, checkout-attempt, fake-confirm payment, and order-record APIs.
- Retain the explicit terms consent and optional marketing consent interactions already approved for the checkout design.
- A successful fake confirmation creates a real local order record and supplies the thank-you page. It does not submit a fulfillment order.

## Required supporting backend additions

- Add a project-creation draft boundary that stores the raw prompt and current reference asset IDs independently of an individual generation request. The draft is private, owned by the project, and updated with optimistic revision handling.
- Add a private reference-image upload route. It validates an image before private storage, records it as a project `REFERENCE` asset, and returns only controlled asset metadata to the browser.
- Expose the current credit balance to the create flow without exposing ledger internals.
- Add a development-only, explicit credit-grant command for local testing. It writes a normal `GRANT` ledger entry; credit refill is never automatic and the command is unavailable in production.
- Configure both guest and authenticated initial development credit grants as five.

## Data and security boundaries

- All project, draft, asset, generation, prepress, cart, checkout, and order reads enforce the current guest or authenticated owner.
- Reference assets and generated originals remain private; consumer clients access preview derivatives through authenticated project routes only.
- Generation API responses expose controlled status and preview metadata, never raw provider payloads, storage keys, internal prompts, or local-credit grant controls.
- Existing passwordless session migration continues to move projects, carts, orders, and the credit account atomically.

## Out of scope

- A real AI image-generation provider, provider benchmark decision, paid credit purchase, or automatic credit refill.
- Stripe payment capture, Printify/Monster Digital fulfillment creation, or production shipping contracts.
- Account subpages, menu/support-page migration, referral behavior, and non-primary-store journeys.
- Any UX redesign of the approved prototype primary flow.

## Verification

- A new guest completes the entire journey from Step 1 to thank-you using five initial credits and one deterministic generation.
- A signed-in visitor follows the same journey, and guest-owned data and remaining credits survive sign-in.
- Prompt, reference asset, style/tone, color, and size persist across a page reload before generation.
- A successful generation consumes one ledger credit; failed, rejected, and cancelled generations do not consume a credit.
- Invalid input, stale revision, unavailable credit, upload failure, prepress failure, cart failure, and fake-payment failure render the approved shared feedback treatment without corrupting state.
- Run migrations, relevant domain/API integration tests, web typecheck/lint/build, and a mobile LAN smoke test.
