import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');

describe('orders list column alignment', () => {
  it('right-aligns the Total header and values with one shared rule', () => {
    expect(styles).toMatch(
      /\.commerce-admin-table-scroll th:last-child,\s*\.commerce-admin-table-scroll td:last-child\s*{\s*text-align:\s*right;/,
    );
  });

  it('does not show a persistent scrollbar below desktop view tabs', () => {
    expect(styles).toMatch(/\.commerce-admin-tabs\s*{[^}]*overflow-x:\s*visible;/s);
    expect(styles).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.commerce-admin-tabs\s*{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;/,
    );
  });
});
