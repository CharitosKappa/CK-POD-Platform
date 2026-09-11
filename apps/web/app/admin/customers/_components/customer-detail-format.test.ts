import { describe, expect, it } from 'vitest';

import { customerDisplayName, customerDuration } from './customer-detail-format';

describe('customer detail formatting', () => {
  it('uses the customer name when any name component exists', () => {
    expect(
      customerDisplayName({
        firstName: '  Ari ',
        lastName: ' Tsoukala ',
        name: 'Fallback name',
        email: 'ari@example.com',
      }),
    ).toBe('Ari Tsoukala');
    expect(
      customerDisplayName({ firstName: '', lastName: 'Doe', name: '', email: 'doe@example.com' }),
    ).toBe('Doe');
  });

  it('uses the resolved customer name before falling back to email', () => {
    expect(
      customerDisplayName({
        firstName: ' ',
        lastName: '',
        name: 'Taylor Example',
        email: 'guest@example.com',
      }),
    ).toBe('Taylor Example');
    expect(
      customerDisplayName({ firstName: ' ', lastName: '', name: '', email: 'guest@example.com' }),
    ).toBe('guest@example.com');
  });

  it('formats the largest useful completed duration unit', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(customerDuration(new Date('2026-09-05T12:00:00Z'), now)).toBe('6 days');
    expect(customerDuration(new Date('2026-03-11T12:00:00Z'), now)).toBe('6 months');
    expect(customerDuration(new Date('2024-06-11T12:00:00Z'), now)).toBe('2 years');
  });
});
