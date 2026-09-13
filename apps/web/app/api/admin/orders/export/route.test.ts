import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orderExportRuntime, request, requireAdminSession } = vi.hoisted(() => ({
  orderExportRuntime: vi.fn(),
  request: vi.fn(),
  requireAdminSession: vi.fn(),
}));
vi.mock('../../../../../lib/platform', () => ({ orderExportRuntime, requireAdminSession }));
import { POST } from './route';

describe('POST /api/admin/orders/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ staffMemberId: 'staff-1' });
    orderExportRuntime.mockResolvedValue({ request });
  });
  it('streams immediate CSV exports', async () => {
    request.mockResolvedValue({
      mode: 'IMMEDIATE',
      fileName: 'orders.csv',
      totalCount: 1,
      body: new TextEncoder().encode('Order ID\r\n#1'),
    });
    const response = await POST(
      new Request('http://localhost/api/admin/orders/export', {
        method: 'POST',
        body: JSON.stringify({
          selection: { type: 'IDS', orderIds: ['00000000-0000-4000-8000-000000000002'] },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('orders.csv');
    expect(await response.text()).toContain('#1');
  });
  it('returns 202 for queued exports', async () => {
    request.mockResolvedValue({ mode: 'QUEUED', export: { id: 'export-1', status: 'QUEUED' } });
    const response = await POST(
      new Request('http://localhost/api/admin/orders/export', {
        method: 'POST',
        body: JSON.stringify({ selection: { type: 'FILTER', filters: { view: 'ALL' } } }),
      }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ mode: 'QUEUED' });
  });
});
