import type { SqlPool } from './index.js';

export const integrityChecks = [
  [
    'delivered_without_shipment',
    `SELECT count(*)::text AS count FROM app.orders o
     WHERE o.status = 'DELIVERED'
       AND NOT EXISTS (SELECT 1 FROM app.order_shipments s WHERE s.order_id = o.id)
       AND NOT EXISTS (
         SELECT 1 FROM app.order_fulfillment_status_events e
         WHERE e.order_id = o.id
           AND e.normalized_status IN ('SHIPPED', 'DELIVERED')
       )`,
  ],
  [
    'refund_exceeds_capture',
    `SELECT count(*)::text AS count FROM app.orders o
     JOIN app.payments p ON p.checkout_attempt_id = o.checkout_attempt_id
     WHERE (
       SELECT coalesce(sum(amount_cents), 0)
       FROM app.order_refunds r
       WHERE r.order_id = o.id AND r.status IN ('PENDING', 'SUCCEEDED')
     ) > p.amount_cents`,
  ],
  [
    'negative_credit_balance',
    `SELECT count(*)::text AS count FROM app.credit_accounts WHERE current_balance < 0`,
  ],
] as const;

/**
 * Runs data invariants against authoritative state. A delivered order is valid
 * only when either a shipment row or normalized provider shipment/delivery
 * history explains the state; raw provider text alone is not sufficient.
 */
export async function integrityViolationCounts(pool: SqlPool): Promise<Record<string, number>> {
  const entries = await Promise.all(
    integrityChecks.map(async ([name, query]) => {
      const result = await pool.query<{ count: string }>(query);
      return [name, Number(result.rows[0]?.count ?? 0)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function verifyDatabaseIntegrity(pool: SqlPool): Promise<void> {
  const counts = await integrityViolationCounts(pool);
  const failures = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name]) => name);
  for (const [name, count] of Object.entries(counts)) console.info(`${name}=${count}`);
  if (failures.length) throw new Error(`Integrity checks failed: ${failures.join(', ')}`);
  console.info('Database integrity verification passed.');
}
