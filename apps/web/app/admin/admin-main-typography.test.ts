import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

describe('admin main-body typography and feedback styling', () => {
  it('defines a larger readable type scale only inside the admin main panel', () => {
    expect(styles).toMatch(
      /\.commerce-admin-main\s*{[^}]*--admin-body-size:\s*0\.9375rem;[^}]*--admin-helper-size:\s*0\.8125rem;[^}]*--admin-control-size:\s*0\.9375rem;[^}]*--admin-compact-size:\s*0\.75rem;[^}]*--admin-section-heading-size:\s*1rem;/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main \.commerce-admin-table-scroll table,[\s\S]*?\.commerce-admin-main \.customer-directory-table\s*{[^}]*font-size:\s*var\(--admin-body-size\);/,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main :where\(button, input, select, textarea\)\s*{[^}]*font-size:\s*var\(--admin-control-size\);/s,
    );
    expect(styles).not.toMatch(
      /\.commerce-admin-sidebar[^}]*var\(--admin-(?:body|helper|control|compact|section-heading)-size\)/s,
    );
  });

  it('normalizes the complete admin hierarchy without changing the Printing modal scale', () => {
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(p, address, li, td, dd\):not\(\.order-printing-modal \*\)\s*{[^}]*font-size:\s*var\(--admin-body-size\);/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(small, time, label\):not\(\.order-printing-modal \*\)\s*{[^}]*font-size:\s*var\(--admin-helper-size\);/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(h2, h3\):not\(\.order-printing-modal \*\)\s*{[^}]*font-size:\s*var\(--admin-section-heading-size\);/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(button, input, select, textarea\):not\(\.order-printing-modal \*\)\s*{[^}]*font-size:\s*var\(--admin-control-size\);/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(th, \.commerce-status, \.order-layer-badge\):not\(\.order-printing-modal \*\)\s*{[^}]*font-size:\s*var\(--admin-compact-size\);/s,
    );
    const printingModalRoot = styles.match(/\.order-printing-modal\s*{(?<body>[^}]*)}/)?.groups
      ?.body;
    expect(printingModalRoot).toBeDefined();
    expect(printingModalRoot).not.toMatch(
      /var\(--admin-(?:body|helper|control|compact|section-heading)-size\)/,
    );
  });

  it('contains larger sortable table headings inside their existing columns', () => {
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(th\):not\(\.order-printing-modal \*\)\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main\s+:where\(\.customer-sort-button, \.order-sort-button\):not\(\.order-printing-modal \*\)\s*{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
  });

  it('styles a distinct accessible dismiss control without changing layout width', () => {
    expect(styles).toMatch(
      /\.admin-feedback\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(styles).toMatch(/\.admin-feedback-dismiss\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
    expect(styles).toMatch(/\.admin-feedback-dismiss:focus-visible\s*{[^}]*outline:/s);
  });
});
