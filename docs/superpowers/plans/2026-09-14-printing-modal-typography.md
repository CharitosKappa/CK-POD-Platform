# Printing Modal Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase the Printing modal's typography to a clearly readable but still compact desktop scale.

**Architecture:** Define modal-local typography tokens on `.order-printing-modal` and replace its existing sub-12px declarations with semantic title, heading, body, metadata, and control sizes. Keep every selector scoped to the modal so the compact Printing summary and admin sidebar remain unchanged.

**Tech Stack:** CSS, TypeScript, Vitest, Next.js

**Spec:** `docs/superpowers/specs/2026-09-14-printing-modal-typography-design.md`

## Global Constraints

- Only descendants of `.order-printing-modal` change.
- Modal dimensions, layout, colors, interactions, and internal scrolling remain unchanged.
- Title is 18px; section headings are 15px; body/value text is 14px; metadata is 12px; controls are 12–13px.
- The compact `.order-printing-summary` and fixed admin sidebar must not consume the modal tokens.

---

### Task 1: Apply the modal-local typography scale

**Files:**

- Create: `apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Produces: `--printing-modal-title-size`, `--printing-modal-heading-size`, `--printing-modal-body-size`, `--printing-modal-meta-size`, and `--printing-modal-control-size` CSS custom properties scoped to `.order-printing-modal`.
- Consumes: existing Printing modal selectors only.

- [ ] **Step 1: Write the failing CSS contract test**

Create a Vitest file that reads `apps/web/app/globals.css` and asserts the modal defines the approved scale:

```ts
expect(styles).toMatch(
  /\.order-printing-modal\s*{[^}]*--printing-modal-title-size:\s*1\.125rem;[^}]*--printing-modal-heading-size:\s*0\.9375rem;[^}]*--printing-modal-body-size:\s*0\.875rem;[^}]*--printing-modal-meta-size:\s*0\.75rem;[^}]*--printing-modal-control-size:\s*0\.8125rem;/s,
);
```

Assert the title, section headings, status values, item names, economics amounts, event text, metadata, and buttons consume their matching tokens. Assert `.order-printing-summary` does not contain any `--printing-modal-*` reference.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm test -- "apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts"
```

Expected: FAIL because the modal tokens and token-based consumers do not exist.

- [ ] **Step 3: Define the approved local scale**

Add these properties to the existing `.order-printing-modal` rule:

```css
--printing-modal-title-size: 1.125rem;
--printing-modal-heading-size: 0.9375rem;
--printing-modal-body-size: 0.875rem;
--printing-modal-meta-size: 0.75rem;
--printing-modal-control-size: 0.8125rem;
```

- [ ] **Step 4: Replace the Printing modal's tiny fixed sizes**

Use the title token for the modal `h2`; heading token for section `h3`; body token for status values, readiness/blocker copy, muted copy, item names, economics values, and provider-event primary text; metadata token for eyebrow text, labels, item metadata, event metadata/times, state pills, and footer date; control token for footer/error buttons. Keep badge padding, hit targets, modal dimensions, grids, and responsive rules unchanged.

- [ ] **Step 5: Run the focused typography and Printing component tests**

```powershell
pnpm test -- "apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts" "apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- apps/web/app/globals.css "apps/web/app/admin/orders/[orderNumber]/printing-modal-typography.test.ts"
git commit -m "style: enlarge printing modal typography"
```

### Task 2: Verify desktop readability and regressions

**Files:**

- Verify only; no expected source changes.

**Interfaces:**

- Consumes: Task 1.
- Produces: browser and automated evidence for the scoped typography change.

- [ ] **Step 1: Inspect the Printing modal in the desktop admin**

Open an Order Detail page, open its Printing modal, and verify the title, status panel, readiness, item rows, economics, provider events, footer date, and buttons are readable. Confirm the modal remains 760px wide, scrolls internally, and the compact Printing summary row outside it is unchanged.

- [ ] **Step 2: Run repository verification**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits 0; integration-only tests may remain explicitly skipped.

- [ ] **Step 3: Confirm a clean worktree**

```powershell
git status --short
```

Expected: empty output.
