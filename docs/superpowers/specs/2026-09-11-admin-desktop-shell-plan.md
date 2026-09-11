# Admin desktop shell implementation plan

1. Add `apps/web/lib/admin-preferences.ts` as the shared browser preference boundary. Define the versioned storage key, the expanded default, strict parsing for saved JSON, and safe read/write helpers that tolerate unavailable or malformed storage.
2. Add `apps/web/lib/admin-preferences.test.ts` to cover the default, valid collapsed/expanded values, malformed JSON, incomplete data, unsupported values, and persistence through a storage-compatible test double.
3. Add `apps/web/app/admin/admin-shell.tsx` as a focused client component. It receives the authenticated staff presentation data and page content from the server layout, restores the sidebar preference before revealing the interactive shell, exposes one collapsed-state attribute, persists toggle changes, and leaves the mobile header behavior intact.
4. Refactor `apps/web/app/admin/layout.tsx` so it retains authentication and session loading on the server while delegating only presentation state and shell markup to `AdminShell`.
5. Update `apps/web/app/admin/admin-navigation.tsx` and `apps/web/app/admin/admin-sign-out-button.tsx` with dedicated visual-label elements, stable accessible names, tooltip labels, and compact icon affordances required by the `72px` rail.
6. Update the admin section of `apps/web/app/globals.css` to:
   - define expanded and collapsed sidebar-width variables;
   - transition the fixed sidebar and main offset from the single shell state;
   - style and position the collapse/expand control;
   - hide labels, secondary brand text, pending-navigation content, and account copy in the icon-only state;
   - expose hover/focus tooltips without making navigation hover-dependent;
   - preserve route, focus, account, and sign-out affordances in both states;
   - remove the `1280px` caps from commerce and embedded operational admin pages;
   - use desktop horizontal gutters clamped between `32px` and `48px`;
   - disable layout motion under `prefers-reduced-motion`;
   - keep the existing mobile breakpoint and menu behavior unchanged.
7. Run targeted formatting, preference unit tests, full typecheck, lint, production build, and `git diff --check`.
8. Restart the local development server, then perform desktop browser QA on dashboard, orders, and an operational detail page. Verify full-width sizing, expanded/collapsed offsets, current-route state, keyboard toggle, tooltips, refresh persistence, and the unchanged mobile breakpoint.
