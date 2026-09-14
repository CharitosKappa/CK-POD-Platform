# Admin Feedback and Typography Design

**Date:** 2026-09-14  
**Status:** Approved direction, pending written-spec review

## Objective

Improve the desktop admin interface in two consistent ways:

1. Action feedback can always be dismissed manually. Success and informational feedback also closes automatically after four seconds, while errors remain visible until dismissed.
2. Body text throughout the admin main content becomes larger and easier to read, without changing the sidebar typography or weakening the existing visual hierarchy.

## Approaches Considered

### 1. Shared feedback component and scoped typography tokens — selected

Create one reusable admin feedback component and apply a small set of main-content typography variables and scoped component adjustments. This gives consistent timing, accessibility, close-button behavior, and font sizing while preserving headings, compact status pills, and the unchanged sidebar.

### 2. Page-by-page changes

Add timers, close buttons, and larger font sizes independently to each admin page. This is faster for one screen but creates inconsistent behavior and duplicated timer logic as the admin expands.

### 3. Global scaling of the main panel

Scale the entire main panel with CSS zoom or broad descendant overrides. This changes typography quickly but also scales spacing, controls, tables, and modal geometry, creating overflow and hierarchy regressions.

The selected approach provides the best consistency and lowest layout risk.

## Feedback Behavior

A shared client component will render page-level action feedback with three tones: `success`, `info`, and `error`.

- Every feedback message includes a visible `×` button with an accessible label.
- Success and informational feedback dismisses automatically after 4,000 milliseconds.
- Error feedback never auto-dismisses.
- A new message restarts the timer.
- Unmounting or manually dismissing the message clears its timer.
- The close button is keyboard accessible and has a visible focus state.
- Success/info use `role="status"`; errors use `role="alert"`.
- Existing recovery actions such as `Try again` remain available inside persistent error feedback.

The shared component applies to page-level feedback produced after admin actions on Customers, Customer Detail, Orders, and Order Detail. Inline validation inside an open form or modal remains persistent and continues to be cleared by correcting the input or closing the modal; it is not converted into a transient toast.

## Typography

Typography changes are scoped under `.commerce-admin-main`; `.commerce-admin-sidebar` is explicitly excluded and remains unchanged.

The main body will receive a modest, consistent increase rather than global visual zoom:

- standard body copy, table cells, form controls, buttons, and links increase by approximately 1–2 CSS pixels;
- compact metadata and helper text receive a readable minimum while remaining visually subordinate;
- page titles and intentionally prominent headings retain their current scale;
- status badges remain compact but readable;
- line-height is adjusted where necessary to prevent crowding after the increase;
- desktop full-width layout, gutters, table alignment, modal sizing, and responsive behavior remain unchanged.

The implementation will use admin-scoped variables and targeted component selectors so later admin sections inherit the same typography system without affecting the storefront.

## Component Boundary

The reusable feedback component owns only presentation and dismissal timing. Parent screens continue to own the message state and supply the dismissal callback. No backend, database, action eligibility, or API behavior changes.

## Verification

Automated tests will cover:

- manual dismissal for every tone;
- automatic dismissal at four seconds for success and info;
- error persistence beyond four seconds;
- timer restart and cleanup when the message changes or unmounts;
- correct status/alert semantics and accessible close label;
- integration of the shared component in the four page-level admin feedback surfaces;
- CSS scope confirming the main body typography changes do not target the sidebar.

The final gate is format, lint, typecheck, focused component tests, full unit tests, production build, and desktop browser inspection of Customers, Customer Detail, Orders, and Order Detail.

## Non-goals

- Changing sidebar typography or dimensions.
- Changing storefront typography.
- Turning field validation into disappearing messages.
- Changing colors, page structure, spacing system, or business logic unrelated to feedback and readability.
