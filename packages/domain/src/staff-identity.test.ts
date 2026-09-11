import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it, vi } from 'vitest';

import { StaffIdentityService } from './staff-identity.js';

describe('StaffIdentityService.requestCode', () => {
  it('returns the generated code for an eligible staff member while persisting only its hash', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    const pool = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        queries.push({ text, values });
        if (text.includes('SELECT id FROM app.staff_members')) {
          return { rows: [{ id: 'staff-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as SqlPool;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const code = await new StaffIdentityService(pool, { pepper: 'test-pepper' }).requestCode(
      'STAFF@example.com',
    );

    expect(code).toMatch(/^\d{6}$/);
    const insert = queries.find((query) => query.text.includes('staff_email_challenges'));
    const challengeInsert = queries.find((query) => query.text.startsWith('INSERT'));
    expect(insert).toBeDefined();
    expect(challengeInsert?.values?.[1]).not.toBe(code);
    expect(challengeInsert?.values?.[1]).toMatch(/^[a-f0-9]{64}$/);
    info.mockRestore();
  });

  it('returns null and creates no challenge for an unknown email address', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = { query } as unknown as SqlPool;

    const code = await new StaffIdentityService(pool, { pepper: 'test-pepper' }).requestCode(
      'unknown@example.com',
    );

    expect(code).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
