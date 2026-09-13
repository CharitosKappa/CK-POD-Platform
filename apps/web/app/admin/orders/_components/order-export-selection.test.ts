import { describe, expect, it } from 'vitest';
import { activeOrderExportSelection } from './order-export-selection';
import { clearOrderSelection, selectAllMatchingOrders, toggleOrder } from './order-selection';

const filters = {
  query: 'tee',
  view: 'IN_PROGRESS' as const,
  paymentStatus: 'SUCCEEDED' as const,
  printingStatus: 'PRINTED' as const,
  fulfillmentStatus: 'FULFILLED' as const,
  dateFrom: '2026-09-01',
  dateTo: '2026-09-13',
  minTotal: '20.25',
  maxTotal: '80',
  customerId: '',
};
describe('active order export selection', () => {
  it('maps explicit selected UUIDs', () => {
    const state = toggleOrder(clearOrderSelection(), '00000000-0000-4000-8000-000000000002');
    expect(activeOrderExportSelection(state, filters)).toEqual({
      type: 'IDS',
      orderIds: ['00000000-0000-4000-8000-000000000002'],
    });
  });
  it('maps all-result filters, cents, and exclusions', () => {
    const state = toggleOrder(selectAllMatchingOrders(), '00000000-0000-4000-8000-000000000003');
    expect(activeOrderExportSelection(state, filters)).toEqual({
      type: 'FILTER',
      filters: {
        query: 'tee',
        view: 'IN_PROGRESS',
        paymentStatus: 'SUCCEEDED',
        printingStatus: 'PRINTED',
        fulfillmentStatus: 'FULFILLED',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-13',
        minTotalCents: 2025,
        maxTotalCents: 8000,
      },
      excludedOrderIds: ['00000000-0000-4000-8000-000000000003'],
    });
  });
});
