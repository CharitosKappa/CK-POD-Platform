import { describe, expect, it } from 'vitest';

import { parseOrderListUrlState, writeOrderListUrlState } from './order-list-url-state';

describe('order list URL state', () => {
  it('round-trips every shareable order filter', () => {
    const state = parseOrderListUrlState(
      new URLSearchParams(
        'q=taylor&view=IN_PROGRESS&sort=TOTAL_DESC&page=3&payment=SUCCEEDED&printing=PRINTED&fulfillment=FULFILLED&from=2026-09-01&to=2026-09-13&minTotal=20&maxTotal=80',
      ),
    );

    expect(state).toEqual({
      query: 'taylor',
      view: 'IN_PROGRESS',
      sort: 'TOTAL_DESC',
      page: 3,
      paymentStatus: 'SUCCEEDED',
      printingStatus: 'PRINTED',
      fulfillmentStatus: 'FULFILLED',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-13',
      minTotal: '20',
      maxTotal: '80',
      customerId: '',
    });
    expect(writeOrderListUrlState(state).toString()).toBe(
      'q=taylor&view=IN_PROGRESS&sort=TOTAL_DESC&page=3&payment=SUCCEEDED&printing=PRINTED&fulfillment=FULFILLED&from=2026-09-01&to=2026-09-13&minTotal=20&maxTotal=80',
    );
  });

  it('uses safe defaults for invalid enum and page values', () => {
    expect(
      parseOrderListUrlState(
        new URLSearchParams('view=NOPE&sort=BROKEN&page=-1&payment=NOPE&printing=NOPE'),
      ),
    ).toEqual({
      query: '',
      view: 'ALL',
      sort: 'DATE_DESC',
      page: 1,
      paymentStatus: '',
      printingStatus: '',
      fulfillmentStatus: '',
      dateFrom: '',
      dateTo: '',
      minTotal: '',
      maxTotal: '',
      customerId: '',
    });
  });

  it('preserves the customer-detail order filter', () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const state = parseOrderListUrlState(new URLSearchParams(`customerId=${customerId}`));
    expect(state.customerId).toBe(customerId);
    expect(writeOrderListUrlState(state).get('customerId')).toBe(customerId);
  });
});
