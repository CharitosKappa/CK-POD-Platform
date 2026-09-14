# Admin Panel Typography Scale Design

## Goal

Improve readability throughout the desktop admin main body without making the interface feel oversized or reducing the useful density of Shopify-style tables and cards.

## Scope

The change applies to the commerce admin main content, including dashboard content, Orders, Customers, detail pages, timelines, cards, forms, tables, pagination, badges, feedback messages, and action modals.

The admin sidebar is explicitly excluded. The Printing modal keeps its already-approved isolated typography scale and must not inherit a second increase.

## Approved Type Scale

- Primary body copy, table cells, monetary values, and important row content: `15px`.
- Supporting copy, field labels, timestamps, helper text, and secondary metadata: `13px`.
- Inputs, selects, textareas, and buttons: `14px` to `15px`, based on visual importance.
- Table headers, compact badges, and dense status metadata: `12px` to `13px`.
- Section and card headings: `16px`.
- Existing page-level display headings retain their established hierarchy unless they are currently below the approved readable scale.

## Implementation Direction

Use semantic typography custom properties on `.commerce-admin-main` and targeted admin-only overrides. This avoids a blunt percentage zoom, preserves layout control for dense tables, and creates a reusable hierarchy for future admin screens.

Existing component selectors that currently force smaller sizes must be normalized to the approved tokens. The work must cover Customers and Orders list/detail screens, shared cards, timelines, forms, dialogs, filters, pagination, exports, and feedback surfaces.

## Layout and Behavior Constraints

- Do not change the sidebar typography.
- Do not change modal dimensions, page widths, table column definitions, gutters, or responsive breakpoints.
- Do not change the Printing modal typography tokens.
- Preserve horizontal scrolling for tables where required.
- Preserve all interaction, sorting, filtering, pagination, bulk selection, export, and order-action behavior.
- Where increased text reveals an existing overflow issue, preserve the current truncation or wrapping intent rather than widening the overall layout.

## Verification

- Add a CSS contract test for the global admin typography tokens and isolation rules.
- Run focused admin typography and component tests.
- Visually inspect representative Customers list, Customer detail, Orders list, Order detail, and at least one non-Printing action modal.
- Confirm the sidebar and Printing modal remain unchanged.
- Run format, lint, typecheck, full tests, and production build.

