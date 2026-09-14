import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

describe('admin main-body typography and feedback styling', () => {
  it('defines a larger readable type scale only inside the admin main panel', () => {
    expect(styles).toMatch(
      /\.commerce-admin-main\s*{[^}]*--admin-body-size:\s*0\.875rem;[^}]*--admin-helper-size:\s*0\.75rem;/s,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main \.commerce-admin-table-scroll table,[\s\S]*?\.commerce-admin-main \.customer-directory-table\s*{[^}]*font-size:\s*var\(--admin-body-size\);/,
    );
    expect(styles).toMatch(
      /\.commerce-admin-main :where\(button, input, select, textarea\)\s*{[^}]*font-size:\s*var\(--admin-control-size\);/s,
    );
    expect(styles).not.toMatch(
      /\.commerce-admin-sidebar[^}]*var\(--admin-(?:body|helper|control)-size\)/s,
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
