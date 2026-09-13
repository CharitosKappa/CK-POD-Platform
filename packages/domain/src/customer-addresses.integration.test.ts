import { randomUUID } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CustomerOperationsService } from './customer-operations';

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const suite = integrationDatabaseUrl ? describe : describe.skip;

suite('customer address book integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);
  const service = new CustomerOperationsService(database.pool);
  const customerId = randomUUID();
  const actor = {
    staffMemberId: randomUUID(),
    email: `address-admin-${randomUUID()}@example.test`,
    role: 'OPERATIONS' as const,
  };
  const address = {
    recipientName: 'Alex Morgan',
    line1: '1 First Street',
    city: 'Miami',
    stateCode: 'FL',
    postalCode: '33101',
    countryCode: 'US',
  };

  beforeAll(async () => {
    await database.pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status)
       VALUES ($1,$2,'OPERATIONS','ACTIVE')`,
      [actor.staffMemberId, actor.email],
    );
    await database.pool.query(
      `INSERT INTO app.customer_profiles (id,normalized_email,first_seen_source)
       VALUES ($1,$2,'CHECKOUT')`,
      [customerId, `address-${customerId}@example.test`],
    );
  });

  afterAll(async () => {
    await database.pool.query('DELETE FROM app.customer_profiles WHERE id=$1', [customerId]);
    await database.pool.query('DELETE FROM app.staff_members WHERE id=$1', [actor.staffMemberId]);
    await database.close();
  });

  it('keeps one scoped default while adding, editing, and removing addresses', async () => {
    const firstId = await service.createCustomerAddress(actor, customerId, address);
    const secondId = await service.createCustomerAddress(actor, customerId, {
      ...address,
      line1: '2 Second Street',
    });
    await service.updateCustomerAddress(actor, customerId, secondId, {
      ...address,
      line1: '22 Updated Street',
      isDefault: true,
    });

    const beforeDelete = await database.pool.query<{
      id: string;
      line1: string;
      is_default: boolean;
    }>(
      `SELECT id,line1,is_default FROM app.customer_addresses
       WHERE customer_profile_id=$1 ORDER BY id`,
      [customerId],
    );
    expect(beforeDelete.rows.filter((entry) => entry.is_default)).toEqual([
      expect.objectContaining({ id: secondId, line1: '22 Updated Street' }),
    ]);

    await service.deleteCustomerAddress(actor, customerId, secondId);
    await expect(
      database.pool.query<{ id: string; is_default: boolean }>(
        `SELECT id,is_default FROM app.customer_addresses WHERE customer_profile_id=$1`,
        [customerId],
      ),
    ).resolves.toMatchObject({ rows: [{ id: firstId, is_default: true }] });
    await expect(
      database.pool.query<{ event_type: string }>(
        `SELECT event_type FROM app.customer_timeline_events
         WHERE customer_profile_id=$1 ORDER BY created_at,id`,
        [customerId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { event_type: 'ADDRESS_ADDED' },
        { event_type: 'ADDRESS_ADDED' },
        { event_type: 'ADDRESS_UPDATED' },
        { event_type: 'ADDRESS_REMOVED' },
      ],
    });
  });
});
