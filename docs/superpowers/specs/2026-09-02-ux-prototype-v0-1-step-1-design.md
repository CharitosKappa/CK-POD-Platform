# UX Prototype v0.1 — Step 1: Create

## Purpose and boundary

Create a disposable, mobile-first browser prototype for CEO and product review of only the first creation step: describing an idea for a T-shirt. The implementation lives entirely in `apps/ux-prototype` and must be removable without changing the production application.

The prototype uses Next.js, React, and TypeScript. It uses static fixtures, static local assets, in-browser React state, and a local object URL for a selected reference-image preview. It has no API routes, database, queue, authentication, analytics, provider SDK, production API call, or import from `apps/web` or production runtime services.

Workspace registration may be mechanical because `pnpm-workspace.yaml` already includes `apps/*`. The production app and M0–M10 packages are not modified.

## Primary experience

### Approved flow revision — Idea first

This revision supersedes every earlier statement in this document that places color, size, variant availability, or the size guide on the initial screen. The approved pre-generation journey is:

1. **Idea:** prompt and optional local-only reference image.
2. **Style:** Style Family, Substyle, and Surprise Me.
3. **Color / Size:** product context, color selection, size selection, Size Guide, and variant availability.
4. **Generate:** actual AI generation starts only after Step 3 is confirmed.

Only **Step 1 — Idea** is implemented in UX Prototype v0.1. Steps 2–4 remain explicit future placeholders. Color may influence later AI generation context. Size remains later variant/commerce context, not AI prompt content unless a future qualified product rule explicitly changes that.

The initial consumer screen contains only the mobile header, value proposition, a neutral premium blank garment as product context, prompt composer, optional reference image, a `Choose a Style →` CTA, and the low-emphasis “Free to create · Pay when you order” reassurance. It contains no color or size controls, color/size sheets, size guide, or color/size validation.

The neutral hero does not imply a selected garment variant. It uses the replaceable white static garment fixture without a visual card/frame, color name, swatch, product name, price, or selection state.

The design authority is a 390 × 844 CSS-pixel mobile viewport. The screen remains usable at 360 × 800, 430 × 932, and widths down to approximately 320 pixels without horizontal scrolling. Desktop is supported incidentally, not designed first.

The screen presents this order:

1. Compact header: menu button, `LET IT BE`, fixed prototype-only `1 credit` remaining indicator, and cart affordance with a conditional mock-count badge.
2. Value proposition: a smaller, condensed treatment of “Turn your idea into a shirt worth wearing.” with supporting copy, “Describe what you want. We’ll handle the rest.”
3. Large, centered, front-facing neutral photorealistic static garment fixture with no product context copy.
4. Creative prompt composer labelled `What should we put on your shirt?` with the example placeholder `A funny Viking drinking coffee...`, multiline entry, visible focus, and character count.
5. Optional local-only reference image with image picker, thumbnail preview, and removal control.
6. Dominant `Choose a Style →` CTA, prompt-only contextual validation, and low-emphasis “Free to create · Pay when you order” reassurance.

No Step 2 styling options, cart flow, checkout, account pages, editor, generation, upload, or navigation destination is included.

## Components and state

For the approved Idea-first implementation, `CreateExperience` owns only active theme, prompt, selected local image URL, drawer visibility, prompt validation, fixed prototype-only credit balance, mock cart count, and local completion message. Existing color/size fixture and bottom-sheet code may remain as isolated, unused future-step scaffolding, but is not rendered or reachable from Step 1.

Small components separate the visual areas and make their responsibilities clear:

- `CanvasMenu` is a single floating overflow affordance that opens the drawer; it is not a persistent header.
- `NavigationDrawer` renders the agreed future structure and a bottom sign-in link. Items are intentionally inert.
- `GarmentHero` renders the neutral reusable static garment fixture and product context.
- `PromptComposer` renders prompt entry, count, focus style, and contextual error.
- `ReferenceImage` creates an in-browser object URL only, previews it, and revokes it on replacement/removal/unmount.
- `PrototypeControls` sits outside the consumer composition and switches token sets A, B, and C.

Color, size, and availability fixtures may remain locally available for the later dedicated merchandise step. They have no current Step 1 UI, state, validation, or implied selection.

## Interaction and validation

For Step 1, only a non-empty prompt is required. `Choose a Style →` creates no request and transitions only to “Step 1 complete — Style selection coming next.”

The CTA does not issue a request. It requires a prompt only. On invalid submit, the prompt error appears adjacent to the composer in human language. On valid submit, a local completion state appears: “Step 1 complete — Style selection coming next.” This is the explicit boundary of the prototype.

The drawer and sheets use labelled buttons, escape/backdrop close where appropriate, visible focus, `role="dialog"` with modal semantics, focus transfer on open and restore on close, and touch targets near 44–48 pixels. The layout uses responsive tokenized spacing and avoids hover-only behavior. Input and controls remain scrollable/reachable while a mobile keyboard is open.

## Visual directions

The `Prototype controls` switcher exposes three token-only explorations:

- **A — Ink / Bone / Vermilion:** editorial ink and bone surfaces with a vermilion primary action.
- **B — Ink / Porcelain / Cobalt:** crisp ink and porcelain surfaces with a cobalt primary action.
- **C — Warm Black / Cream / Oxblood:** deep warm-black canvas, cream type, and an oxblood primary action.

All three directions share layout and components. CSS variables centrally define background, primary/secondary text, primary action and text, borders, surfaces, selected state, radius, spacing, and typography scale. These directions are review controls and are not consumer UI.

## Canvas composition controls

Prototype controls expose three non-consumer, headerless composition explorations, independent of the A/B/C visual themes:

1. **Creative canvas:** generous garment space and centered prompt hierarchy.
2. **Editorial poster:** a small vertical `LET IT BE` signature with left-aligned editorial copy.
3. **Object-first:** garment-led top half with the composer emerging below it.

All use a single floating overflow affordance for the existing drawer. The fixed prototype-only credit fixture appears below the CTA rather than in a header. They are for CEO comparison only and do not change the Step 1 flow.

The Creative canvas is the current hybrid review direction: its headline is intentionally set over two lines, its supporting sentence is a single line, and its composer overlaps the lower garment area. The visible prompt label is removed while its accessible label remains. Before focus, the composer has a subtle transparent lower fade; it becomes an ordinary opaque composer on focus so prompt entry stays clear.

## Asset approach

Use a premium front-facing White static garment fixture on a neutral soft-stone presentation stage for Step 1. Black and Navy local fixtures are reserved for the later Color / Size step. Each must read as a garment with fabric, collar, sleeve, and soft studio-light detail rather than a flat silhouette. The fixture set is documented in the app readme as replaceable and prototype-only; it is not derived from production rendering.

## Commands, local network, and verification

The prototype package exposes `dev`, `lint`, `typecheck`, `build`, and format-check commands compatible with repository tooling. The dev command binds to `0.0.0.0` on port 3001, allowing `http://localhost:3001` and a LAN address based on the host’s active private IPv4 address. No tunnel or deployment is created. `Prototype controls` is deliberately easy to reach during review and exposes A/B/C palette selection; on desktop it may also expose a non-consumer 360/390/430 preview-width control.

Verification covers format, lint, type checking, and prototype build; manual/reasoned checks at 360, 390, and 430 pixels; prompt validation; reference preview/removal; drawer behavior; absence of visible or reachable Color / Size controls; zero backend side effects from CTA; local completion state; and all three themes. The prompt composer uses a 16px font on mobile to prevent iOS Safari focus zoom. The final report explicitly confirms the absence of backend/database/provider connectivity and unchanged production/domain behavior.
