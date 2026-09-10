# Admin full-width workspace

## Decision

The internal admin workspace uses the full viewport width to the right of its fixed sidebar at desktop sizes. This applies consistently to dashboard, lists, records, and future operational screens.

## Layout rules

- The sidebar keeps its current fixed desktop width and becomes the mobile header at the existing mobile breakpoint.
- `.ops-admin-main` remains the flexible remainder of the viewport.
- Every `.ops-admin-page` occupies 100% of that remainder with no centered maximum width or automatic horizontal margins.
- Responsive page padding remains the only inset, protecting touch targets and readability without artificially narrowing tables, operational lists, or detail panels.
- Component-level grids retain their own responsive behavior; this change does not stretch form controls or narrow text columns beyond their existing layout rules.

## Validation

- Customers, Orders, Dashboard, Providers, Review Queue, and future admin pages share the same page shell.
- At mobile widths, the existing one-column shell and page padding remain unchanged.
