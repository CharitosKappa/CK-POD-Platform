# UX prototype — Help and legal pages

## Goal

Create individual mobile-first pages for every supporting menu destination. There is no intermediate Help hub or directory page.

## Page set and navigation

The full-screen menu routes directly to these standalone destinations:

- `FAQ` — grouped, closed-by-default accordions for design creation, orders and delivery, payments, returns, and accounts/credits.
- `Contact` — a short contact form with Email and Message fields, a concise submit CTA, inline validation, and an in-place success confirmation. It does not send a real message yet.
- `Shipping` — temporary delivery, fulfillment, tracking, and shipping-cost information.
- `Payments` — temporary payment, security, authorization, and refund information. It must not promise a payment provider or live checkout integration.
- `Returns & refunds` — temporary eligibility and refund-process information.
- `Terms & Conditions` — temporary structured legal copy; retains a stable `/terms` URL.
- `Privacy Policy` — temporary structured legal copy; retains a stable `/privacy` URL.

`Shipping`, `Returns & refunds`, `FAQ`, and `Contact` are linked from the menu's supporting-link area. `Help & support` in the primary menu opens the FAQ page. Payment, Terms, and Privacy are surfaced from the relevant supporting pages, and Terms/Privacy remain directly linkable from sign-in and checkout.

## Shared page design

- Every destination is its own page, rather than a section inside one large help page.
- Use a compact top row: back arrow at left, centred LET IT BE wordmark, and menu trigger at right.
- Use the existing warm background, black editorial typography, quiet dividers, red only for interactive focus/primary actions, and 16px-or-larger form text to avoid iOS input zoom.
- Each page starts with a simple eyebrow, clear title, and short plain-language introduction. The content is visibly structured but does not label itself as test or prototype content.
- Back returns to the menu when opened from the menu; direct legal URLs retain a reliable path back to the store.

## Contact form behavior

- Required Email: email keyboard and browser validation.
- Required Message: multiline field with a concise prompt.
- Submit validates locally and shows the existing standardized inline feedback style on error or success.
- No real message delivery, ticket creation, or customer-data persistence is introduced.

## Temporary legal content

Temporary copy is structured in sections so each page reads like a complete destination without presenting it as final legal advice. The sections cover the expected subject matter only and make no provider-specific, regulatory, or contractual claims that have not been approved.

## Verification

- Verify every menu link opens the intended standalone page and the back/menu controls work on mobile.
- Verify FAQ accordion keyboard behavior and contact validation/success states.
- Verify Terms and Privacy links from checkout and sign-in still open `/terms` and `/privacy`.
- Run formatting, TypeScript, lint, production build, and `git diff --check`.
