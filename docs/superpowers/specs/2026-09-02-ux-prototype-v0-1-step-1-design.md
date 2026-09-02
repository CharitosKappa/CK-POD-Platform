# UX Prototype v0.1 — Step 1: Create

## Purpose and boundary

Create a disposable, mobile-first browser prototype for CEO and product review of only the first creation step: describing an idea for a T-shirt. The implementation lives entirely in `apps/ux-prototype` and must be removable without changing the production application.

The prototype uses Next.js, React, and TypeScript. It uses static fixtures, static local assets, in-browser React state, and a local object URL for a selected reference-image preview. It has no API routes, database, queue, authentication, analytics, provider SDK, production API call, or import from `apps/web` or production runtime services.

Workspace registration may be mechanical because `pnpm-workspace.yaml` already includes `apps/*`. The production app and M0–M10 packages are not modified.

## Primary experience

The design authority is a 390 × 844 CSS-pixel mobile viewport. The screen remains usable at 360 × 800, 430 × 932, and widths down to approximately 320 pixels without horizontal scrolling. Desktop is supported incidentally, not designed first.

The screen presents this order:

1. Compact header: menu button, `LET IT BE`, and cart affordance with a conditional mock-count badge.
2. Configurable value proposition: “Turn your idea into a shirt worth wearing.” with supporting copy, “Describe what you want. We’ll handle the rest.”
3. Large, centered, front-facing photorealistic static garment fixture. It is prototype-only and replaceable. A color treatment visibly changes with the selected fixture color.
4. Product summary: `Classic T-Shirt` and `$39.99`.
5. Two compact configuration controls: color and size.
6. Creative prompt composer labelled `What should we put on your shirt?` with the example placeholder `A funny Viking drinking coffee...`, multiline entry, visible focus, and character count.
7. Optional local-only reference image with image picker, thumbnail preview, and removal control.
8. Dominant `Create My Shirt` CTA, contextual validation, and low-emphasis “Free to create · Pay when you order” reassurance.

No Step 2 styling options, cart flow, checkout, account pages, editor, generation, upload, or navigation destination is included.

## Components and state

`CreateExperience` owns the local interaction state: active theme, selected color, selected size, prompt, selected local image URL, drawer visibility, active bottom sheet, validation messages, mock cart count, and simulated completion message.

Small components separate the visual areas and make their responsibilities clear:

- `MobileHeader` opens the drawer and renders the mock cart badge.
- `NavigationDrawer` renders the agreed future structure and a bottom sign-in link. Items are intentionally inert.
- `GarmentHero` renders the reusable static garment fixture and color-dependent visual treatment.
- `ProductConfiguration` renders product summary plus color and size controls.
- `BottomSheet` provides accessible dialog semantics, backdrop click and close-button dismissal, focus-safe behavior, and vertically scrollable content. It is used for color, size, and the lightweight prototype-only size guide.
- `PromptComposer` renders prompt entry, count, focus style, and contextual error.
- `ReferenceImage` creates an in-browser object URL only, previews it, and revokes it on replacement/removal/unmount.
- `PrototypeControls` sits outside the consumer composition and switches token sets A, B, and C.

Fixture availability is defined locally. Black is initially selected; size has no default selection. Navy deliberately marks M unavailable. If M is selected and the user changes to Navy, the selected size is cleared and the UI states: “M isn’t available in Navy. Choose another size.” No replacement size is selected silently.

## Interaction and validation

Color and size controls each open a mobile bottom sheet rather than a desktop-centered dialog. Color options have circular swatches, names, selection text/iconography in addition to color, and large touch targets. Size options contain S, M, L, XL, and 2XL; unavailable combinations are visibly disabled. The size sheet includes a `Size guide` affordance. It opens a lightweight prototype-only sheet with mock sizing information and a simple “How to measure” treatment; it has no production data dependency.

The CTA does not issue a request. It requires non-empty prompt and selected size. On invalid submit, errors appear adjacent to the relevant control in human language. On valid submit, a local completion state appears: “Step 1 complete — Style selection coming next.” This is the explicit boundary of the prototype.

The drawer and sheets use labelled buttons, escape/backdrop close where appropriate, visible focus, `role="dialog"` with modal semantics, focus transfer on open and restore on close, and touch targets near 44–48 pixels. The layout uses responsive tokenized spacing and avoids hover-only behavior. Input and controls remain scrollable/reachable while a mobile keyboard is open.

## Visual directions

The `Prototype controls` switcher exposes three token-only explorations:

- **A — Ink / Bone / Vermilion:** editorial ink and bone surfaces with a vermilion primary action.
- **B — Ink / Porcelain / Cobalt:** crisp ink and porcelain surfaces with a cobalt primary action.
- **C — Warm Black / Cream / Oxblood:** deep warm-black canvas, cream type, and an oxblood primary action.

All three directions share layout and components. CSS variables centrally define background, primary/secondary text, primary action and text, borders, surfaces, selected state, radius, spacing, and typography scale. These directions are review controls and are not consumer UI.

## Asset approach

Use premium front-facing Black, Navy, and White static garment fixtures stored under `apps/ux-prototype/public`. Each must read as a garment with fabric, collar, sleeve, and soft studio-light detail rather than a flat silhouette. CSS tinting is only an explicit fallback when independently credible static variants would be disproportionately expensive. The fixture set is documented in the app readme as replaceable and prototype-only; it is not derived from production rendering.

## Commands, local network, and verification

The prototype package exposes `dev`, `lint`, `typecheck`, `build`, and format-check commands compatible with repository tooling. The dev command binds to `0.0.0.0` on port 3001, allowing `http://localhost:3001` and a LAN address based on the host’s active private IPv4 address. No tunnel or deployment is created. `Prototype controls` is deliberately easy to reach during review and exposes A/B/C palette selection; on desktop it may also expose a non-consumer 360/390/430 preview-width control.

Verification covers format, lint, type checking, and prototype build; manual/reasoned checks at 360, 390, and 430 pixels; color and size sheets; no default size; unavailable and invalidated-size behavior; prompt validation; reference preview/removal; zero backend side effects from CTA; and all three themes. The final report explicitly confirms the absence of backend/database/provider connectivity and unchanged production/domain behavior.
