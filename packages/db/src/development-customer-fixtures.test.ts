import { describe, expect, it } from 'vitest';

import {
  assertDevelopmentCustomerResetTarget,
  developmentCustomerFixtures,
  isPricedDevelopmentOrder,
} from './development-customer-fixtures';

describe('development customer fixtures', () => {
  it('defines exactly 20 unique US customers with English as their only locale', () => {
    expect(developmentCustomerFixtures).toHaveLength(20);
    expect(new Set(developmentCustomerFixtures.map((customer) => customer.email)).size).toBe(20);
    expect(developmentCustomerFixtures.every((customer) => customer.countryCode === 'US')).toBe(
      true,
    );
    expect(developmentCustomerFixtures.every((customer) => customer.preferredLocale === 'en')).toBe(
      true,
    );
    expect(
      new Set(developmentCustomerFixtures.map((customer) => customer.emailMarketingStatus)),
    ).toEqual(new Set(['NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED']));
    expect(
      new Set(developmentCustomerFixtures.map((customer) => customer.smsMarketingStatus)),
    ).toEqual(new Set(['NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED']));
  });

  it('accepts only orders with a positive integer total for customer spend fixtures', () => {
    expect(isPricedDevelopmentOrder({ totalCents: '4899' })).toBe(true);
    expect(isPricedDevelopmentOrder({ totalCents: null })).toBe(false);
    expect(isPricedDevelopmentOrder({ totalCents: '' })).toBe(false);
    expect(isPricedDevelopmentOrder({ totalCents: '0' })).toBe(false);
    expect(isPricedDevelopmentOrder({ totalCents: '-100' })).toBe(false);
    expect(isPricedDevelopmentOrder({ totalCents: 'not-a-number' })).toBe(false);
  });

  it('allows only the local development database and rejects test or remote targets', () => {
    expect(() =>
      assertDevelopmentCustomerResetTarget(
        'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe',
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertDevelopmentCustomerResetTarget(
        'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe_test',
        {},
      ),
    ).toThrow('development database');
    expect(() =>
      assertDevelopmentCustomerResetTarget(
        'postgresql://letitbe:letitbe@db.example.com:5432/letitbe',
        {},
      ),
    ).toThrow('local PostgreSQL');
    expect(() =>
      assertDevelopmentCustomerResetTarget('postgresql://letitbe:letitbe@localhost:5432/letitbe', {
        INTEGRATION_TEST_DATABASE: '1',
      }),
    ).toThrow('integration test');
  });
});
