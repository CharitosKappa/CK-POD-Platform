import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../../globals.css', import.meta.url), 'utf8');

describe('printing modal typography', () => {
  it('defines the approved modal-only type scale', () => {
    expect(styles).toContain('--printing-modal-title-size: 1.125rem;');
    expect(styles).toContain('--printing-modal-heading-size: 0.9375rem;');
    expect(styles).toContain('--printing-modal-body-size: 0.875rem;');
    expect(styles).toContain('--printing-modal-meta-size: 0.75rem;');
    expect(styles).toContain('--printing-modal-control-size: 0.8125rem;');
  });

  it('applies the scale to the modal hierarchy', () => {
    expect(styles).toMatch(
      /\.order-printing-modal > header h2\s*\{[^}]*font-size:\s*var\(--printing-modal-title-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-modal-section h3\s*\{[^}]*font-size:\s*var\(--printing-modal-heading-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-modal-status-panel strong\s*\{[^}]*font-size:\s*var\(--printing-modal-body-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-modal-items strong\s*\{[^}]*font-size:\s*var\(--printing-modal-body-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-economics dd\s*\{[^}]*font-size:\s*var\(--printing-modal-body-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-provider-events strong\s*\{[^}]*font-size:\s*var\(--printing-modal-body-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-modal-status-panel small\s*\{[^}]*font-size:\s*var\(--printing-modal-meta-size\)/s,
    );
    expect(styles).toMatch(
      /\.order-printing-modal > footer button,[\s\S]*?font-size:\s*var\(--printing-modal-control-size\)/,
    );
  });

  it('does not leak the modal type scale into the compact printing summary', () => {
    const summaryRules = styles.match(/\.order-printing-summary[^}]*\}/g) ?? [];
    expect(summaryRules.length).toBeGreaterThan(0);
    expect(summaryRules.join('\n')).not.toContain('--printing-modal-');
  });
});
