# Admin desktop shell: full-width content and collapsible sidebar

## Objective

Make the desktop admin workspace use all available horizontal space to the right of its sidebar while keeping the interface readable. Add a persistent expanded/collapsed sidebar control so staff can choose between a full navigation panel and a compact icon rail.

## Scope

This change applies to the authenticated admin desktop shell and every page rendered inside it, including commerce dashboard, orders, customers, and reused operational detail views. Mobile navigation remains unchanged.

## Desktop layout

- The expanded sidebar remains `248px` wide.
- The collapsed sidebar becomes a `72px` icon rail.
- The main content fills the complete remaining viewport width.
- Existing `1280px` content caps are removed from both native commerce admin pages and operational pages rendered inside the admin shell.
- Horizontal content gutters use a responsive value between `32px` and `48px` on desktop.
- Content never renders underneath the sidebar. The sidebar and main-content offsets transition together when the state changes.

## Sidebar behavior

- A clearly discoverable toggle switches between expanded and collapsed states.
- Expanded state shows the existing brand, navigation icons and labels, section labels, staff identity, role, and sign-out control.
- Collapsed state retains the brand mark, navigation icons, toggle, staff avatar, and a compact sign-out affordance.
- Text labels and section headings are visually hidden in collapsed state rather than leaving unused horizontal space.
- Navigation items expose accessible names in both states. Collapsed items provide tooltips on pointer hover and keyboard focus.
- The current-route indication remains visible in both states.

## Preference persistence

- Sidebar state is stored in `localStorage` under a versioned admin-preferences namespace.
- A small shared browser preference boundary owns parsing, defaults, validation, and writes. Future comparable UI choices can use the same boundary instead of creating unrelated storage keys.
- The default for browsers without a saved preference is expanded.
- Invalid or unavailable stored data falls back safely to the expanded state.
- The saved state is applied before the admin shell becomes visibly interactive to avoid a distracting expanded-to-collapsed flash.
- The preference is browser-local and does not synchronize between devices or staff accounts.

## Component boundary

The server layout continues to own authentication and session loading. A focused client-side admin-shell component owns only sidebar presentation state and persistence. Navigation data and authorization remain unchanged.

The shell exposes its state through a semantic state attribute or CSS variable. CSS derives sidebar width, main offset, label visibility, tooltips, and transitions from that single state rather than duplicating layout logic across pages.

## Accessibility and interaction

- The toggle is a real button with `aria-expanded`, an explicit accessible label, and visible focus treatment.
- Tooltips are supplementary; navigation does not depend on hover.
- The collapsed rail remains fully usable with keyboard navigation.
- Motion respects `prefers-reduced-motion`.
- Desktop changes do not replace or interfere with the existing mobile menu behavior below the current breakpoint.

## Verification

- Unit tests cover preference parsing, default behavior, persistence, and invalid stored values.
- Typecheck, lint, and production build must pass.
- Desktop browser QA covers expanded and collapsed states on dashboard, orders, and an operational detail page.
- QA verifies full-width content, correct sidebar offsets, keyboard access, tooltips, current-route styling, refresh persistence, and unchanged mobile navigation.

## Out of scope

- Server-side or database-backed staff preferences.
- Cross-device preference synchronization.
- Changes to admin information architecture, navigation destinations, permissions, or page content.
- Mobile navigation redesign.
