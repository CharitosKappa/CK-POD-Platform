import { describe, expect, it } from 'vitest';

import { adminOrderSorts, adminOrderViews } from './admin-order-contracts';

describe('admin order contracts', () => {
  it('defines the approved order views and sortable columns', () => {
    expect(adminOrderViews).toEqual([
      'ALL',
      'OPEN',
      'IN_PROGRESS',
      'COMPLETED',
      'ATTENTION',
      'CANCELLED',
    ]);
    expect(adminOrderSorts).toContain('ORDER_NUMBER_ASC');
    expect(adminOrderSorts).toContain('TOTAL_DESC');
    expect(adminOrderSorts).toContain('FULFILLMENT_ASC');
  });
});
