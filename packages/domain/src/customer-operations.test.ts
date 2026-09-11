import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';

import { CustomerOperationsService } from './customer-operations';

const actor = {
  staffMemberId: '00000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'operations@example.test',
};

function customerIds(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
}

describe('customer bulk selection', () => {
  it('exports selections larger than one customer page', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.exportCustomers(actor, customerIds(264))).resolves.toContain('Name,Email');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps a bounded maximum for admin bulk operations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.exportCustomers(actor, customerIds(10_001))).rejects.toThrow(
      'Choose between 1 and 10,000 customers.',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
