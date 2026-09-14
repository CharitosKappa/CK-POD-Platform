# Admin Panel Typography Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase typography across the admin main body to a readable, controlled scale while preserving the existing layout density, sidebar typography, and Printing modal scale.

**Architecture:** Extend the existing semantic typography tokens on `.commerce-admin-main`, then add a late admin-only normalization block for shared surfaces and the Customers and Orders interfaces. Keep the Printing modal on its isolated `--printing-modal-*` tokens and verify that neither it nor the sidebar consumes the new main-body scale.

**Tech Stack:** Next.js, React, TypeScript, CSS custom properties, Vitest

**Spec:** `docs/superpowers/specs/2026-09-14-admin-panel-typography-scale-design.md`

## Global Constraints

- Primary body copy, table cells, monetary values, and important row content use `15px`.
- Supporting copy, field labels, timestamps, helper text, and secondary metadata use `13px`.
- Inputs, selects, textareas, and buttons use `14px` to `15px` based on importance.
- Table headers, compact badges, and dense status metadata use `12px` to `13px`.
- Section and card headings use `16px`.
- Do not change sidebar typography, Printing modal tokens, modal dimensions, page widths, table columns, gutters, or responsive breakpoints.
- Preserve all existing admin behavior.

---

### Task 1: Establish the approved semantic scale

**Files:**

- Modify: `apps/web/app/admin/admin-main-typography.test.ts`
- Modify: `apps/web/app/globals.css:2315-2410`

**Interfaces:**

- Consumes: `.commerce-admin-main` as the boundary around commerce admin content.
- Produces: `--admin-body-size`, `--admin-helper-size`, `--admin-control-size`, `--admin-compact-size`, and `--admin-section-heading-size` CSS custom properties.

- [ ] **Step 1: Update the CSS contract test to require the approved tokens**

```ts
expect(styles).toMatch(
  /\.commerce-admin-main\s*{[^}]*--admin-body-size:\s*0\.9375rem;[^}]*--admin-helper-size:\s*0\.8125rem;[^}]*--admin-control-size:\s*0\.9375rem;[^}]*--admin-compact-size:\s*0\.75rem;[^}]*--admin-section-heading-size:\s*1rem;/s,
);
expect(styles).not.toMatch(
  /\.commerce-admin-sidebar[^}]*var\(--admin-(?:body|helper|control|compact|section-heading)-size\)/s,
);
```

- [ ] **Step 2: Run the focused test and verify the token contract fails**

Run:

```powershell
pnpm test -- "apps/web/app/admin/admin-main-typography.test.ts"
```

Expected: FAIL because the existing main body tokens are `0.875rem` and `0.75rem`, and the new tokens do not exist.

- [ ] **Step 3: Update the main-body tokens**

```css
.commerce-admin-main {
  --admin-body-size: 0.9375rem;
  --admin-helper-size: 0.8125rem;
  --admin-control-size: 0.9375rem;
  --admin-compact-size: 0.75rem;
  --admin-section-heading-size: 1rem;
  font-size: var(--admin-body-size);
  line-height: 1.45;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
pnpm test -- "apps/web/app/admin/admin-main-typography.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit the semantic scale**

```powershell
git add -- apps/web/app/admin/admin-main-typography.test.ts apps/web/app/globals.css
git commit -m "style: raise admin typography scale"
```

---

### Task 2: Normalize Customers, Orders, and shared admin surfaces

**Files:**

- Modify: `apps/web/app/admin/admin-main-typography.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: the five `.commerce-admin-main` typography tokens from Task 1.
- Produces: consistent readable text across shared cards, tables, filters, forms, timelines, pagination, feedback, Customers pages, Orders pages, and non-Printing action dialogs.

- [ ] **Step 1: Add representative coverage assertions for every hierarchy level**

```ts
expect(styles).toMatch(
  /\.commerce-admin-main\s+:where\(p, address, li, td, dd\):not\(\.order-printing-modal \*\)[\s\S]*?font-size:\s*var\(--admin-body-size\);/,
);
expect(styles).toMatch(
  /\.commerce-admin-main\s+:where\(th, \.commerce-status, \.order-layer-badge\):not\(\.order-printing-modal \*\)[\s\S]*?font-size:\s*var\(--admin-compact-size\);/,
);
expect(styles).toMatch(
  /\.commerce-admin-main\s+:where\(small, time, label\):not\(\.order-printing-modal \*\)[\s\S]*?font-size:\s*var\(--admin-helper-size\);/,
);
expect(styles).toMatch(
  /\.commerce-admin-main\s+:where\(h2, h3\):not\(\.order-printing-modal \*\)[\s\S]*?font-size:\s*var\(--admin-section-heading-size\);/,
);
expect(styles).toMatch(
  /\.commerce-admin-main\s+:where\(button, input, select, textarea\):not\(\.order-printing-modal \*\)[\s\S]*?font-size:\s*var\(--admin-control-size\);/,
);
```

Also retain assertions proving `.commerce-admin-sidebar` and `.order-printing-modal` do not consume `--admin-*` typography variables.

- [ ] **Step 2: Run the focused test and verify the component coverage fails**

Run:

```powershell
pnpm test -- "apps/web/app/admin/admin-main-typography.test.ts" "apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts"
```

Expected: FAIL on the new representative component assertions while the Printing modal contract remains green.

- [ ] **Step 3: Add a late, scoped typography normalization block**

Place the block after the existing Customers and Orders component rules but before the isolated Printing modal rules. Use explicit semantic groups rather than a page-wide transform or browser zoom.

```css
/* Final readable scale for commerce admin content, excluding the fixed sidebar and Printing modal. */
.commerce-admin-main :where(p, address, li, td, dd):not(.order-printing-modal *) {
  font-size: var(--admin-body-size);
}

.commerce-admin-main :where(small, time, label):not(.order-printing-modal *) {
  font-size: var(--admin-helper-size);
}

.commerce-admin-main :where(h2, h3):not(.order-printing-modal *) {
  font-size: var(--admin-section-heading-size);
}

.commerce-admin-main :where(button, input, select, textarea):not(.order-printing-modal *) {
  font-size: var(--admin-control-size);
}

.commerce-admin-main :where(th, .commerce-status, .order-layer-badge):not(.order-printing-modal *) {
  font-size: var(--admin-compact-size);
}

.commerce-admin-main
  :where(
    .commerce-admin-table-scroll td,
    .customer-directory-table td,
    .customer-timeline strong,
    .order-timeline strong,
    .order-summary-list dd,
    .order-line-item strong,
    .customer-contact-links,
    .customer-sidebar-address,
    .customer-sidebar-subsection,
    .customer-sidebar-card-value,
    .customer-info-list > div,
    .order-detail-meta,
    .order-provider-group
  ):not(.order-printing-modal *) {
  font-size: var(--admin-body-size);
}
```

The `:not(.order-printing-modal *)` guard is required on every normalization selector. Preserve existing font weights, line heights, truncation, wrapping, dimensions, and spacing.

- [ ] **Step 4: Run the focused admin component suite**

Run:

```powershell
pnpm test -- "apps/web/app/admin/admin-main-typography.test.ts" "apps/web/app/admin/orders/orders-list-layout.test.ts" "apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts" "apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts" "apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts" "apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts"
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit component normalization**

```powershell
git add -- apps/web/app/admin/admin-main-typography.test.ts apps/web/app/globals.css
git commit -m "style: normalize admin content typography"
```

---

### Task 3: Visual and full regression verification

**Files:**

- Verify only: `apps/web/app/globals.css`
- Verify only: `apps/web/app/admin/admin-main-typography.test.ts`

**Interfaces:**

- Consumes: the complete semantic scale and component normalization from Tasks 1 and 2.
- Produces: evidence that readability improved without layout or interaction regressions.

- [ ] **Step 1: Format the changed files**

Run:

```powershell
.\node_modules\.bin\prettier.cmd --write "apps/web/app/globals.css" "apps/web/app/admin/admin-main-typography.test.ts"
```

- [ ] **Step 2: Inspect representative desktop screens**

Open and inspect:

- `/admin/customers`
- one `/admin/customers/[customerId]`
- `/admin/orders`
- one `/admin/orders/[orderNumber]`
- one non-Printing order-action modal
- the Printing modal

Confirm table headers remain compact, cells are readable, rows and cards do not overlap, controls fit their containers, long values retain their intended truncation or wrapping, the sidebar remains unchanged, and the Printing modal still uses its isolated 18/15/14/12px hierarchy.

- [ ] **Step 3: Run complete verification**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits `0`.

- [ ] **Step 4: Confirm repository state**

Run:

```powershell
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors and no unintended files.
