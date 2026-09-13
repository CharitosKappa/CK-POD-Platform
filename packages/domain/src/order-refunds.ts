import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { PaymentService } from './commerce-contracts';
import { adjustStoreCreditWithClient } from './store-credit';

export type RefundActor =
  | { type: 'STAFF'; staffMemberId: string; role: 'OWNER' | 'OPERATIONS'; email: string }
  | { type: 'USER'; userId: string; email: string };

export interface RefundOrderInput {
  orderNumber: string;
  amountCents: number;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}

export interface RefundOrderResult {
  refundId: string;
  destination: 'ORIGINAL_PAYMENT' | 'STORE_CREDIT';
  amountCents: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  duplicate: boolean;
  /** Retained for the existing CX refund response. */
  providerRefundId: string | null;
}

interface RefundRow {
  id: string;
  order_id: string;
  destination: RefundOrderResult['destination'];
  amount_cents: number;
  status: RefundOrderResult['status'];
  provider_refund_id: string | null;
}

interface PaidOrderRow {
  id: string;
  customer_profile_id: string | null;
  payment_id: string;
  provider: 'FAKE' | 'STRIPE';
  provider_payment_id: string;
  amount_cents: number;
  currency: string;
}

interface RefundAnalytics {
  emit(input: {
    name: string;
    idempotencyKey: string;
    orderId?: string;
    dimensions: Record<string, unknown>;
  }): Promise<void>;
}

function result(row: RefundRow, duplicate: boolean): RefundOrderResult {
  return {
    refundId: row.id,
    destination: row.destination,
    amountCents: row.amount_cents,
    status: row.status,
    providerRefundId: row.provider_refund_id,
    duplicate,
  };
}

/** Caller holds the order row lock shared by revisions and refund reservations. */
export async function editedOrderBalanceWithClient(
  client: SqlClient,
  orderId: string,
  totalCents: number,
) {
  const balance = (
    await client.query<{ paid: number }>(
      `SELECT (CASE WHEN payment.status='SUCCEEDED' THEN payment.amount_cents ELSE 0 END - COALESCE((SELECT sum(amount_cents) FROM app.order_refunds WHERE order_id=$1 AND status IN ('PENDING','SUCCEEDED')),0))::int AS paid FROM app.orders orders JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id WHERE orders.id=$1`,
      [orderId],
    )
  ).rows[0];
  return balance
    ? {
        amountDueCents: Math.max(0, totalCents - balance.paid),
        refundableAdjustmentCents: Math.max(0, balance.paid - totalCents),
      }
    : null;
}

async function lockRefundOrder(client: SqlClient, orderId: string) {
  // The row lock is first, matching admin edits and Order→Groups operations.
  await client.query('SELECT id FROM app.orders WHERE id=$1 FOR UPDATE', [orderId]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orderId]);
}

async function reconcileEditedOrderBalance(client: SqlClient, orderId: string) {
  // Ordinary refunds remain independent of fulfillment. Reconcile only financial
  // revisions (including an unchanged-total edit which reserved a pending refund),
  // not a delivered order whose only revision was a contact/note update.
  const order = (
    await client.query<{ total: number }>(
      `SELECT (pricing_snapshot->>'totalCents')::int AS total FROM app.orders orders WHERE id=$1
     AND EXISTS (SELECT 1 FROM app.order_revisions revision WHERE revision.order_id=orders.id AND (
       revision.before_snapshot->'order'->'pricing_snapshot' IS DISTINCT FROM revision.after_snapshot->'order'->'pricing_snapshot'
       OR COALESCE((revision.after_snapshot->'order'->>'amount_due_cents')::int,0)>0
       OR COALESCE((revision.after_snapshot->'order'->>'refundable_adjustment_cents')::int,0)>0))`,
      [orderId],
    )
  ).rows[0];
  if (!order) return;
  const balance = await editedOrderBalanceWithClient(client, orderId, order.total);
  if (!balance) throw new Error('The order payment is unavailable.');
  await client.query(
    'UPDATE app.orders SET amount_due_cents=$2,refundable_adjustment_cents=$3,updated_at=now() WHERE id=$1 AND (amount_due_cents<>$2 OR refundable_adjustment_cents<>$3)',
    [orderId, balance.amountDueCents, balance.refundableAdjustmentCents],
  );
}

/** Refund reservations share one order lock across both destinations, independent of fulfillment. */
export class OrderRefundService {
  constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
    private readonly analytics?: RefundAnalytics,
  ) {}

  async refundOriginalPayment(
    actor: RefundActor,
    input: RefundOrderInput,
  ): Promise<RefundOrderResult> {
    this.validate(actor, input);
    await this.requireActor(actor);
    const reservation = await withTransaction(this.pool, (client) =>
      this.reserve(client, actor, input, 'ORIGINAL_PAYMENT'),
    );
    if (reservation.duplicate) return result(reservation.refund, true);

    let provider: { providerRefundId: string };
    try {
      provider = await this.payments.refund({
        providerPaymentId: reservation.order.provider_payment_id,
        amountCents: reservation.refund.amount_cents,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, reservation.order.id);
        await client.query(
          `UPDATE app.order_refunds SET status='FAILED' WHERE id=$1 AND status='PENDING'`,
          [reservation.refund.id],
        );
        await reconcileEditedOrderBalance(client, reservation.order.id);
      });
      throw error;
    }

    // External success cannot be undone. Keep the reservation PENDING if local finalization fails.
    const completed = await withTransaction(this.pool, async (client) => {
      await lockRefundOrder(client, reservation.order.id);
      const updated = await client.query<RefundRow>(
        `UPDATE app.order_refunds SET provider_refund_id=$2, status='SUCCEEDED', completed_at=now()
         WHERE id=$1 AND status='PENDING' RETURNING *`,
        [reservation.refund.id, provider.providerRefundId],
      );
      const refund = updated.rows[0];
      if (!refund) throw new Error('Refund reservation is unavailable.');
      await reconcileEditedOrderBalance(client, reservation.order.id);
      await this.audit(client, reservation.order.id, 'refund_succeeded', actor, input, {
        amountCents: refund.amount_cents,
        providerRefundId: provider.providerRefundId,
      });
      return refund;
    });
    await this.emitRefund(this.pool, reservation.order.id, input);
    return result(completed, false);
  }

  async refundToStoreCredit(
    actor: RefundActor,
    input: RefundOrderInput,
  ): Promise<RefundOrderResult> {
    this.validate(actor, input);
    if (actor.type !== 'STAFF') throw new Error('Store Credit refunds require a staff actor.');
    return withTransaction(this.pool, async (client) => {
      const reservation = await this.reserve(client, actor, input, 'STORE_CREDIT');
      if (reservation.duplicate) return result(reservation.refund, true);
      const order = reservation.order;
      if (order.currency !== 'USD')
        throw new Error('Store Credit refunds require a USD order payment.');
      if (!order.customer_profile_id) throw new Error('Order customer is unavailable.');
      const amountCents = reservation.refund.amount_cents;
      const adjustment = await adjustStoreCreditWithClient(
        client,
        actor,
        order.customer_profile_id,
        {
          direction: 'CREDIT',
          amount: `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`,
          reason: 'REFUND',
          ...(input.note === undefined ? {} : { note: input.note }),
          // A refund owns its ledger key; manual adjustments cannot accidentally satisfy this operation.
          idempotencyKey: `order-refund:${reservation.refund.id}`,
        },
      );
      const updated = await client.query<RefundRow>(
        `UPDATE app.order_refunds SET store_credit_ledger_entry_id=$2, status='SUCCEEDED', completed_at=now()
         WHERE id=$1 AND status='PENDING' RETURNING *`,
        [reservation.refund.id, adjustment.entryId],
      );
      const refund = updated.rows[0];
      if (!refund) throw new Error('Refund reservation is unavailable.');
      await reconcileEditedOrderBalance(client, order.id);
      await this.audit(client, order.id, 'refund_succeeded', actor, input, {
        amountCents,
        destination: 'STORE_CREDIT',
        storeCreditLedgerEntryId: adjustment.entryId,
      });
      await this.emitRefund(client, order.id, input, 'STORE_CREDIT');
      return result(refund, false);
    });
  }

  private validate(actor: RefundActor, input: RefundOrderInput) {
    if (
      (actor.type !== 'STAFF' && actor.type !== 'USER') ||
      (actor.type === 'STAFF' && actor.role !== 'OWNER' && actor.role !== 'OPERATIONS') ||
      (actor.type === 'USER' && !actor.userId)
    )
      throw new Error('Operations access is restricted.');
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
      throw new Error('A positive integer refund amount is required.');
    if (typeof input.orderNumber !== 'string' || !input.orderNumber.trim())
      throw new Error('Order is unavailable.');
    if (
      !['CUSTOMER_REQUEST', 'DUPLICATE_CHARGE', 'PRODUCTION_DEFECT', 'CANCELLED'].includes(
        input.reasonCode,
      )
    )
      throw new Error('Unsupported refund reason.');
    if (
      input.note !== undefined &&
      (typeof input.note !== 'string' || (actor.type === 'STAFF' && input.note.length > 1000))
    )
      throw new Error('The internal note must be 1000 characters or fewer.');
    if (
      typeof input.idempotencyKey !== 'string' ||
      (actor.type === 'STAFF' &&
        (input.idempotencyKey.trim().length < 12 || input.idempotencyKey.length > 120))
    )
      throw new Error('Provide an idempotency key between 12 and 120 characters.');
  }

  private async requireActor(actor: RefundActor) {
    if (actor.type === 'STAFF') return;
    const user = await this.pool.query<{ role: string }>('SELECT role FROM app.users WHERE id=$1', [
      actor.userId,
    ]);
    if (!['ADMIN', 'CX_OPS', 'FULFILLMENT_ADMIN'].includes(user.rows[0]?.role ?? ''))
      throw new Error('Operations access is restricted.');
  }

  private async reserve(
    client: SqlClient,
    actor: RefundActor,
    input: RefundOrderInput,
    destination: RefundOrderResult['destination'],
  ) {
    const found = await client.query<PaidOrderRow>(
      `SELECT o.id, o.customer_profile_id, p.id AS payment_id, p.provider,
              p.provider_payment_id, p.amount_cents, p.currency
       FROM app.orders o JOIN app.payments p ON p.checkout_attempt_id=o.checkout_attempt_id
       WHERE o.order_number=$1 AND p.status='SUCCEEDED' FOR UPDATE OF o`,
      [input.orderNumber],
    );
    const order = found.rows[0];
    if (!order) throw new Error('Order payment is unavailable.');
    // Retain the existing CX lock key so both old and new callers share the monetary boundary.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [order.id]);
    // Idempotency keys are global in the existing schema; serialize them across different orders too.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `refund-key:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<RefundRow>(
      'SELECT * FROM app.order_refunds WHERE idempotency_key=$1',
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].order_id !== order.id)
        throw new Error('Refund idempotency key belongs to another order.');
      return { order, refund: existing.rows[0], duplicate: true };
    }
    const prior = await client.query<{ amount: string }>(
      `SELECT coalesce(sum(amount_cents),0)::text AS amount FROM app.order_refunds
       WHERE order_id=$1 AND status IN ('PENDING','SUCCEEDED')`,
      [order.id],
    );
    if (Number(prior.rows[0]?.amount ?? 0) + input.amountCents > order.amount_cents)
      throw new Error('Refund exceeds the captured payment.');
    const inserted = await client.query<RefundRow>(
      `INSERT INTO app.order_refunds (order_id, payment_id, provider, idempotency_key,
         amount_cents, reason_code, status, notes, initiated_by_user_id, initiated_by_staff_member_id, destination)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10) RETURNING *`,
      [
        order.id,
        order.payment_id,
        destination === 'ORIGINAL_PAYMENT' ? order.provider : null,
        input.idempotencyKey,
        input.amountCents,
        input.reasonCode,
        input.note ?? null,
        actor.type === 'USER' ? actor.userId : null,
        actor.type === 'STAFF' ? actor.staffMemberId : null,
        destination,
      ],
    );
    const refund = inserted.rows[0];
    if (!refund) throw new Error('Could not reserve refund.');
    await reconcileEditedOrderBalance(client, order.id);
    await this.audit(client, order.id, 'refund_requested', actor, input, {
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      ...(destination === 'STORE_CREDIT' ? { destination } : {}),
    });
    return { order, refund, duplicate: false };
  }

  private async audit(
    client: SqlClient,
    orderId: string,
    action: string,
    actor: RefundActor,
    input: RefundOrderInput,
    metadata: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO app.order_operational_audits (order_id, action, actor_type, actor_user_id,
         actor_staff_member_id, reason_code, metadata) VALUES ($1,$2,'OPS',$3,$4,$5,$6::jsonb)`,
      [
        orderId,
        action,
        actor.type === 'USER' ? actor.userId : null,
        actor.type === 'STAFF' ? actor.staffMemberId : null,
        input.reasonCode,
        JSON.stringify(metadata),
      ],
    );
  }

  private async emitRefund(
    client: SqlClient,
    orderId: string,
    input: RefundOrderInput,
    destination: RefundOrderResult['destination'] = 'ORIGINAL_PAYMENT',
  ) {
    const dimensions = {
      amountCents: input.amountCents,
      reasonCode: input.reasonCode,
      ...(destination === 'STORE_CREDIT' ? { destination } : {}),
    };
    if (destination === 'ORIGINAL_PAYMENT' && this.analytics) {
      await this.analytics.emit({
        name: 'refund',
        idempotencyKey: `analytics:${input.idempotencyKey}`,
        orderId,
        dimensions,
      });
      return;
    }
    await client.query(
      `INSERT INTO app.analytics_events (event_name, dimensions, idempotency_key)
       VALUES ('refund',$1::jsonb,$2) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        JSON.stringify({ ...dimensions, sessionId: null, userId: null, orderId }),
        `analytics:${input.idempotencyKey}`,
      ],
    );
  }
}
