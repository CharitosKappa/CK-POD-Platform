import { describe, expect, it } from 'vitest';

import {
  assertDevelopmentCustomerResetTarget,
  developmentCustomerFixtures,
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
