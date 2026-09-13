import { createDatabaseClient, type SqlClient } from '../packages/db/src/index';
import {
  assertDevelopmentCustomerResetTarget,
  developmentCustomerFixtures,
  isPricedDevelopmentOrder,
  type DevelopmentCustomerFixture,
} from '../packages/db/src/development-customer-fixtures';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
assertDevelopmentCustomerResetTarget(connectionString, process.env);

const database = createDatabaseClient(connectionString);

async function resetCustomers() {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `WITH archived_orders AS (
         UPDATE app.orders
         SET customer_profile_id=NULL,
             customer_email='archived+' || id::text || '@development.invalid',
             updated_at=now()
         WHERE lower(customer_email) LIKE '%@demo.letitbe.test'
         RETURNING id,customer_email
       )
       UPDATE app.lifecycle_deliveries delivery
       SET recipient_email=archived.customer_email,updated_at=now()
       FROM archived_orders archived WHERE delivery.order_id=archived.id`,
    );
    const orders = await client.query<{ id: string; totalCents: string | null }>(
      `SELECT id, pricing_snapshot->>'totalCents' AS "totalCents" FROM app.orders
       WHERE status NOT IN ('DRAFT','PAYMENT_PENDING','CANCELLED','FAILED')
         AND pricing_snapshot->>'totalCents' ~ '^[1-9][0-9]*$'
         AND NOT EXISTS (SELECT 1 FROM app.order_refunds WHERE order_id=orders.id)
         AND NOT EXISTS (SELECT 1 FROM app.order_reprints WHERE original_order_id=orders.id)
       ORDER BY created_at DESC, id DESC LIMIT 12`,
    );
    if (!orders.rows.every(isPricedDevelopmentOrder))
      throw new Error('Development customer orders must have a positive integer total.');
    await client.query('DELETE FROM app.customer_exports');
    await client.query('DELETE FROM app.customer_notes');
    await client.query('DELETE FROM app.customer_profiles');
    await client.query('DELETE FROM app.customer_tags');

    const profiles: Array<{ id: string; fixture: DevelopmentCustomerFixture }> = [];
    for (const fixture of developmentCustomerFixtures) {
      const profile = await createProfile(client, fixture);
      profiles.push({ id: profile, fixture });
    }
    for (const [index, order] of orders.rows.entries()) {
      const profile = profiles[index % 8]!;
      await client.query(
        `UPDATE app.orders
         SET customer_profile_id=$1, customer_email=$2,
             shipping_address_snapshot=jsonb_set(
               coalesce(shipping_address_snapshot, '{}'::jsonb),
               '{recipientName}', to_jsonb($3::text), true
             ), updated_at=now()
         WHERE id=$4`,
        [
          profile.id,
          profile.fixture.email,
          `${profile.fixture.firstName} ${profile.fixture.lastName}`,
          order.id,
        ],
      );
      await client.query(
        `UPDATE app.order_state_history
         SET actor_staff_member_id=NULL,actor_user_id=NULL
         WHERE order_id=$1`,
        [order.id],
      );
    }
    await client.query(
      `UPDATE app.customer_profiles profile
       SET first_seen_source='ORDER',
           first_seen_at=least(profile.first_seen_at, summary.first_order_at),
           last_seen_at=greatest(profile.last_seen_at, summary.last_order_at),
           updated_at=now()
       FROM (
         SELECT customer_profile_id, min(created_at) AS first_order_at, max(created_at) AS last_order_at
         FROM app.orders WHERE customer_profile_id IS NOT NULL GROUP BY customer_profile_id
       ) summary
       WHERE summary.customer_profile_id=profile.id`,
    );
    await seedStoreCredit(client, profiles);
    const count = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM app.customer_profiles',
    );
    if (count.rows[0]?.count !== '20')
      throw new Error(
        `Expected 20 development customers, found ${count.rows[0]?.count ?? 'none'}.`,
      );
    await client.query('COMMIT');
    console.info('Reset local customer data and created 20 development customers.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createProfile(client: SqlClient, fixture: DevelopmentCustomerFixture) {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO app.customer_profiles (
       normalized_email, first_name, last_name, phone, first_seen_source,
       first_seen_at, last_seen_at, created_at, updated_at,
       email_marketing_status, email_marketing_updated_at,
       sms_marketing_status, sms_marketing_updated_at,
       preferred_locale, preferred_locale_source, preferred_locale_updated_at
     ) VALUES (
       $1,$2,$3,$4,'CHECKOUT',now()-($5::int*interval '1 day'),
       now()-($6::int*interval '1 hour'),now()-($5::int*interval '1 day'),
       now()-($6::int*interval '1 hour'),$7,now()-($6::int*interval '1 hour'),
       $8,now()-($6::int*interval '1 hour'),'en','DEFAULT',NULL
     ) RETURNING id`,
    [
      fixture.email,
      fixture.firstName,
      fixture.lastName,
      fixture.phone,
      fixture.firstSeenDaysAgo,
      fixture.lastSeenHoursAgo,
      fixture.emailMarketingStatus,
      fixture.smsMarketingStatus,
    ],
  );
  const id = inserted.rows[0]!.id;
  await client.query(
    `INSERT INTO app.customer_addresses (
       customer_profile_id,recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,is_default
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
    [
      id,
      `${fixture.firstName} ${fixture.lastName}`,
      fixture.line1,
      fixture.line2,
      fixture.city,
      fixture.stateCode,
      fixture.postalCode,
      fixture.countryCode,
      fixture.phone,
    ],
  );
  for (const tag of fixture.tags) {
    const createdTag = await client.query<{ id: string }>(
      `INSERT INTO app.customer_tags (value) VALUES ($1)
       ON CONFLICT ((lower(value))) DO UPDATE SET value=EXCLUDED.value RETURNING id`,
      [tag],
    );
    await client.query(
      `INSERT INTO app.customer_profile_tags (customer_profile_id,customer_tag_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, createdTag.rows[0]!.id],
    );
  }
  await client.query(
    `INSERT INTO app.customer_timeline_events (customer_profile_id,event_type,metadata,created_at)
     VALUES ($1,'PROFILE_CREATED',$2::jsonb,now()-($3::int*interval '1 day'))`,
    [id, JSON.stringify({ source: 'DEVELOPMENT_FIXTURE' }), fixture.firstSeenDaysAgo],
  );
  if (fixture.note)
    await client.query(
      `INSERT INTO app.customer_timeline_events (customer_profile_id,event_type,body,metadata,created_at)
       VALUES ($1,'NOTE',$2,'{}'::jsonb,now()-($3::int*interval '1 hour'))`,
      [id, fixture.note, fixture.lastSeenHoursAgo],
    );
  return id;
}

async function seedStoreCredit(
  client: SqlClient,
  profiles: Array<{ id: string; fixture: DevelopmentCustomerFixture }>,
) {
  const staff = await client.query<{ id: string }>(
    `SELECT id FROM app.staff_members
     ORDER BY (normalized_email='admin@letitbe.local') DESC,created_at,id LIMIT 1`,
  );
  const staffId = staff.rows[0]?.id;
  if (!staffId) return;
  const balances = [2500, 1500, 0] as const;
  for (const [index, balance] of balances.entries()) {
    const account = await client.query<{ id: string }>(
      `INSERT INTO app.store_credit_accounts (customer_profile_id,current_balance_cents)
       VALUES ($1,$2) RETURNING id`,
      [profiles[index]!.id, balance],
    );
    const accountId = account.rows[0]!.id;
    const originalCredit = balance || 3000;
    await client.query(
      `INSERT INTO app.store_credit_ledger (
         store_credit_account_id,entry_type,amount_cents,balance_after_cents,reason,note,
         actor_staff_member_id,idempotency_key,created_at
       ) VALUES ($1,'CREDIT',$2,$2,'PROMOTION','Development fixture credit',$3,$4,now()-interval '2 days')`,
      [accountId, originalCredit, staffId, `development-credit-${index}`],
    );
    if (balance === 0)
      await client.query(
        `INSERT INTO app.store_credit_ledger (
           store_credit_account_id,entry_type,amount_cents,balance_after_cents,reason,note,
           actor_staff_member_id,idempotency_key,created_at
         ) VALUES ($1,'DEBIT',$2,0,'OTHER','Development fixture redemption',$3,$4,now()-interval '1 day')`,
        [accountId, -originalCredit, staffId, `development-debit-${index}`],
      );
  }
}

void resetCustomers()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => database.close());
