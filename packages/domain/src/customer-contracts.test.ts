import { describe, expect, it } from 'vitest';

import {
  escapeCustomerCsv,
  normalizeCustomerEmail,
  normalizeCustomerTag,
} from './customer-contracts';

describe('customer contracts', () => {
  it('normalizes canonical customer email', () => {
    expect(normalizeCustomerEmail(' Alex@Example.com ')).toBe('alex@example.com');
    expect(() => normalizeCustomerEmail('not-an-email')).toThrow('valid customer email');
  });

  it('normalizes bounded tags', () => {
    expect(normalizeCustomerTag('  Repeat   buyer ')).toBe('Repeat buyer');
    expect(() => normalizeCustomerTag('')).toThrow('customer tag');
  });

  it('escapes CSV values safely', () => {
    expect(escapeCustomerCsv('Alex, Morgan')).toBe('"Alex, Morgan"');
    expect(escapeCustomerCsv('He said "yes"')).toBe('"He said ""yes"""');
    expect(escapeCustomerCsv('plain')).toBe('plain');
  });
});
