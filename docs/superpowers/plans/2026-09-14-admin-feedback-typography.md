# Admin Feedback and Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manually dismissible, timed admin action feedback and increase typography throughout the admin main body without changing the sidebar.

**Architecture:** A focused `AdminFeedback` client component owns accessible rendering and timer cleanup while each page retains ownership of its message state. Main-content typography is expressed through admin-scoped CSS variables and targeted selectors so the storefront and fixed sidebar remain unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, React server rendering for markup contracts.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-feedback-typography-design.md`

## Global Constraints

- Success and informational action feedback auto-dismisses after exactly 4,000 milliseconds.
- Errors never auto-dismiss and require manual dismissal.
- Every page-level action feedback message has a keyboard-accessible `×` button.
- Inline form and modal validation remains persistent and is outside this transient-feedback component.
- Typography changes apply only under `.commerce-admin-main`; the sidebar and storefront remain unchanged.
- Existing business logic, APIs, layout gutters, table alignment, and modal geometry remain unchanged.

---

### Task 1: Shared admin feedback component

**Files:**
- Create: `apps/web/app/admin/_components/admin-feedback.tsx`
- Create: `apps/web/app/admin/_components/admin-feedback.test.tsx`

**Interfaces:**
- Produces: `AdminFeedback({ children, tone, onDismiss })`, `ADMIN_FEEDBACK_DISMISS_MS`, and `scheduleAdminFeedbackDismiss(tone, onDismiss, schedule, cancel)`.
- Consumes: React `useEffect`, `useRef`, and `ReactNode` only.

- [ ] **Step 1: Write failing markup and timer tests**

```tsx
expect(renderToStaticMarkup(
  createElement(AdminFeedback, { tone: 'success', onDismiss }, 'Saved.'),
)).toContain('aria-label="Dismiss message"');

const cleanup = scheduleAdminFeedbackDismiss('success', onDismiss, schedule, cancel);
expect(schedule).toHaveBeenCalledWith(expect.any(Function), 4_000);
cleanup();
expect(cancel).toHaveBeenCalled();

scheduleAdminFeedbackDismiss('error', onDismiss, schedule, cancel);
expect(schedule).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm test -- apps/web/app/admin/_components/admin-feedback.test.tsx`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the component and testable timer boundary**

```tsx
'use client';

export const ADMIN_FEEDBACK_DISMISS_MS = 4_000;
export type AdminFeedbackTone = 'success' | 'info' | 'error';

export function scheduleAdminFeedbackDismiss(
  tone: AdminFeedbackTone,
  onDismiss: () => void,
  schedule = window.setTimeout.bind(window),
  cancel = window.clearTimeout.bind(window),
) {
  if (tone === 'error') return () => undefined;
  const timer = schedule(onDismiss, ADMIN_FEEDBACK_DISMISS_MS);
  return () => cancel(timer);
}

export function AdminFeedback({ children, tone, onDismiss }: Props) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(
    () => scheduleAdminFeedbackDismiss(tone, () => dismiss.current()),
    [children, tone],
  );
  return (
    <div className={`admin-feedback is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>×</button>
    </div>
  );
}
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm test -- apps/web/app/admin/_components/admin-feedback.test.tsx`  
Expected: all shared feedback tests pass.

- [ ] **Step 5: Commit the reusable component**

```bash
git add apps/web/app/admin/_components/admin-feedback.tsx apps/web/app/admin/_components/admin-feedback.test.tsx
git commit -m "feat: add dismissible admin feedback"
```

### Task 2: Adopt feedback consistently on admin screens

**Files:**
- Modify: `apps/web/app/admin/customers/_components/admin-customers-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/orders/_components/admin-orders-client.tsx`
- Modify: `apps/web/app/admin/orders/[orderNumber]/admin-order-detail.tsx`
- Test: `apps/web/app/admin/_components/admin-feedback.test.tsx`

**Interfaces:**
- Consumes: `AdminFeedback` from Task 1.
- Produces: page-level feedback surfaces whose parent state is cleared through `onDismiss`.

- [ ] **Step 1: Add failing integration-contract assertions**

```ts
for (const source of adminPageSources) {
  expect(source).toContain('<AdminFeedback');
  expect(source).not.toMatch(/<p className="(?:customer|ops-admin)-feedback/);
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm test -- apps/web/app/admin/_components/admin-feedback.test.tsx`  
Expected: FAIL because the four page-level surfaces still use raw paragraphs.

- [ ] **Step 3: Replace page-level raw feedback with the shared component**

```tsx
{feedback ? (
  <AdminFeedback tone="success" onDismiss={() => setFeedback(undefined)}>
    {feedback}
  </AdminFeedback>
) : null}
{error ? (
  <AdminFeedback tone="error" onDismiss={() => setError(undefined)}>
    {error}
  </AdminFeedback>
) : null}
```

Orders-list errors retain their existing `Try again` button as a child of `AdminFeedback`. Loading-state copy and inline form/modal validation remain unchanged.

- [ ] **Step 4: Run feedback and affected page tests**

Run: `pnpm test -- apps/web/app/admin/_components/admin-feedback.test.tsx apps/web/app/admin/orders/[orderNumber]/order-actions-ui.test.ts apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts`  
Expected: all tests pass.

- [ ] **Step 5: Commit screen integration**

```bash
git add apps/web/app/admin/customers/_components/admin-customers-client.tsx apps/web/app/admin/customers/_components/customer-detail-client.tsx apps/web/app/admin/orders/_components/admin-orders-client.tsx apps/web/app/admin/orders/[orderNumber]/admin-order-detail.tsx apps/web/app/admin/_components/admin-feedback.test.tsx
git commit -m "refactor: standardize admin action feedback"
```

### Task 3: Increase admin main-body typography

**Files:**
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/app/admin/admin-main-typography.test.ts`

**Interfaces:**
- Produces: `.commerce-admin-main` typography tokens and scoped overrides.
- Consumes: existing admin class names; no component API changes.

- [ ] **Step 1: Add failing CSS scope tests**

```ts
expect(styles).toMatch(/\.commerce-admin-main\s*{[^}]*--admin-body-size:\s*0\.875rem;/s);
expect(styles).toMatch(/\.commerce-admin-main \.commerce-admin-table-scroll table\s*{[^}]*font-size:\s*var\(--admin-body-size\)/s);
expect(styles).not.toMatch(/\.commerce-admin-sidebar[^}]*var\(--admin-body-size\)/s);
expect(styles).toMatch(/\.admin-feedback-dismiss[^}]*width:\s*28px/s);
```

- [ ] **Step 2: Run the CSS contract test and confirm RED**

Run: `pnpm test -- apps/web/app/admin/admin-main-typography.test.ts`  
Expected: FAIL because the typography tokens and feedback styles do not exist.

- [ ] **Step 3: Add scoped typography and feedback styling**

```css
.commerce-admin-main {
  --admin-body-size: 0.875rem;
  --admin-helper-size: 0.75rem;
  --admin-control-size: 0.875rem;
  font-size: var(--admin-body-size);
}

.commerce-admin-main .commerce-admin-table-scroll table,
.commerce-admin-main .customer-directory-table {
  font-size: var(--admin-body-size);
}

.admin-feedback {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.admin-feedback-dismiss {
  width: 28px;
  height: 28px;
}
```

Add targeted overrides for table headers, metadata, helper copy, tabs, buttons, inputs, customer detail cards, order detail cards, and modal body copy. Keep page titles at their existing size and do not reference the typography variables from sidebar selectors.

- [ ] **Step 4: Run CSS and focused component tests**

Run: `pnpm test -- apps/web/app/admin/admin-main-typography.test.ts apps/web/app/admin/_components/admin-feedback.test.tsx`  
Expected: all tests pass.

- [ ] **Step 5: Commit typography**

```bash
git add apps/web/app/globals.css apps/web/app/admin/admin-main-typography.test.ts
git commit -m "style: enlarge admin main typography"
```

### Task 4: Final verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that feedback behavior and typography do not regress the admin build.

- [ ] **Step 1: Run formatting, lint, and typecheck**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`  
Expected: all commands exit 0.

- [ ] **Step 2: Run the complete unit suite**

Run: `pnpm test`  
Expected: all non-integration tests pass.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`  
Expected: all workspace builds complete successfully.

- [ ] **Step 4: Inspect desktop admin routes**

Open Customers, Customer Detail, Orders, and Order Detail. Confirm body text is visibly larger, sidebar typography is unchanged, success/info messages close after four seconds or `×`, errors persist until `×`, and table/modal layouts do not overflow.

- [ ] **Step 5: Record final clean state**

Run: `git diff --check && git status --short`  
Expected: no whitespace errors or uncommitted implementation files.
