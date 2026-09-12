import { describe, expect, it } from 'vitest';

import {
  customerSorts,
  customerViews,
  detectCustomerLocale,
  escapeCustomerCsv,
  normalizeCustomerLocale,
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

  it('normalizes supported customer locales and rejects unsupported values', () => {
    expect(normalizeCustomerLocale('EN_us')).toBe('en');
    expect(() => normalizeCustomerLocale('el-GR')).toThrow('supported customer language');
    expect(() => normalizeCustomerLocale('fr-FR')).toThrow('supported customer language');
  });

  it('detects the highest-priority supported locale from Accept-Language', () => {
    expect(detectCustomerLocale('fr-FR;q=0.9, el-GR;q=0.8, en-US;q=0.7')).toBe('en');
    expect(detectCustomerLocale('en-US,en;q=0.9,el;q=0.8')).toBe('en');
    expect(detectCustomerLocale('el-GR,el;q=0.9')).toBe('en');
    expect(detectCustomerLocale('fr-FR,de-DE;q=0.9')).toBe('en');
    expect(detectCustomerLocale(null)).toBe('en');
  });

  it('escapes CSV values safely', () => {
    expect(escapeCustomerCsv('Alex, Morgan')).toBe('"Alex, Morgan"');
    expect(escapeCustomerCsv('He said "yes"')).toBe('"He said ""yes"""');
    expect(escapeCustomerCsv('plain')).toBe('plain');
  });

  it('exposes both directions for every sortable customer column', () => {
    expect(customerSorts).toEqual(
      expect.arrayContaining([
        'NAME_ASC',
        'NAME_DESC',
        'EMAIL_ASC',
        'EMAIL_DESC',
        'EMAIL_MARKETING_ASC',
        'EMAIL_MARKETING_DESC',
        'LOCATION_ASC',
        'LOCATION_DESC',
        'ORDER_COUNT_ASC',
        'ORDER_COUNT_DESC',
        'TOTAL_SPENT_ASC',
        'TOTAL_SPENT_DESC',
        'LAST_ORDER_ASC',
        'LAST_ORDER_DESC',
        'TAGS_ASC',
        'TAGS_DESC',
        'CUSTOMER_ADDED_ASC',
        'CUSTOMER_ADDED_DESC',
        'CUSTOMER_UPDATED_ASC',
        'CUSTOMER_UPDATED_DESC',
      ]),
    );
    expect(new Set(customerSorts).size).toBe(customerSorts.length);
  });

  it('exposes distinct recency and purchase lifecycle views', () => {
    expect(customerViews).toEqual([
      'ALL',
      'RECENTLY_ADDED',
      'PROSPECTS',
      'FIRST_TIME',
      'RETURNING',
      'HIGH_VALUE',
      'EMAIL_SUBSCRIBERS',
    ]);
  });
});
