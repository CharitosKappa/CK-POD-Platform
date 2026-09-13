import { describe, expect, it } from 'vitest';

import { parseCustomerListUrlState, writeCustomerListUrlState } from './customer-list-url-state';

const defaults = { view: 'RETURNING' as const, sort: 'TOTAL_SPENT_DESC' as const };

describe('customer list URL state', () => {
  it('round-trips every shareable customer filter', () => {
    const state = parseCustomerListUrlState(
      new URLSearchParams(
        'q=maria&view=HIGH_VALUE&sort=NAME_ASC&page=4&hasOrders=1&subscription=SUBSCRIBED&location=Miami',
      ),
      defaults,
    );

    expect(state).toEqual({
      query: 'maria',
      view: 'HIGH_VALUE',
      sort: 'NAME_ASC',
      page: 4,
      hasOrders: true,
      subscription: 'SUBSCRIBED',
      location: 'Miami',
    });
    expect(writeCustomerListUrlState(state).toString()).toBe(
      'q=maria&view=HIGH_VALUE&sort=NAME_ASC&page=4&hasOrders=1&subscription=SUBSCRIBED&location=Miami',
    );
  });

  it('uses validated preferences for missing values and safe defaults for invalid values', () => {
    expect(parseCustomerListUrlState(new URLSearchParams(), defaults)).toMatchObject(defaults);
    expect(
      parseCustomerListUrlState(
        new URLSearchParams('view=NOT_REAL&sort=BROKEN&page=-3&subscription=INVALID'),
        defaults,
      ),
    ).toEqual({
      query: '',
      view: 'RETURNING',
      sort: 'TOTAL_SPENT_DESC',
      page: 1,
      hasOrders: false,
      subscription: '',
      location: '',
    });
  });
});
