import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  PaymentRefundRejectedError,
  PaymentRefundUncertainError,
  type PaymentRefundResult,
  type PaymentRefundSubmissionResult,
  type PaymentService,
} from './commerce-contracts';
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

export interface ReconcileRefundInput {
  orderNumber: string;
  refundId: string;
  /** Identifies this admin recovery request; it is never sent to the payment provider. */
  idempotencyKey: string;
}

interface RefundRow {
  id: string;
  order_id: string;
  idempotency_key: string;
  destination: RefundOrderResult['destination'];
  amount_cents: number;
  status: RefundOrderResult['status'];
  provider_refund_id: string | null;
}

interface RefundReconciliationRow extends RefundRow {
  idempotency_key: string;
  reason_code: string;
  notes: string | null;
}

interface RefundAllocationRow {
  id: string;
  order_refund_id: string;
  order_id: string;
  provider: 'FAKE' | 'STRIPE';
  provider_payment_id: string;
  amount_cents: number;
  currency: 'USD';
  status: RefundOrderResult['status'];
  provider_refund_id: string | null;
  idempotency_key: string;
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

export class EditedOrderBalanceAttributionError extends Error {}

/** Caller holds the order row lock shared by revisions and refund reservations. */
export async function editedOrderBalanceWithClient(
  client: SqlClient,
  orderId: string,
  totalCents: number,
) {
  const context = await editBalanceContext(client, orderId);
  if (!context) return null;
  const pendingRefunds = context.attributed ? [] : await pendingRefundBasis(client, orderId);
  if (context.legacy_revision_id && !context.attributed && pendingRefunds.length)
    throw new EditedOrderBalanceAttributionError(
      'This legacy edited order has unattributed pending refunds. Reconcile their edit responsibility before continuing.',
    );
  // After the first financial revision, the customer owes only the next revision's
  // delta plus any outstanding edit responsibility. Goodwill/refund money is not debt.
  const signed =
    context.attributed || context.legacy_revision_id
      ? context.amount_due_cents - context.refundable_adjustment_cents + totalCents - context.total
      : totalCents - context.paid;
  return {
    amountDueCents: Math.max(0, signed),
    refundableAdjustmentCents: Math.max(0, -signed),
    pendingRefunds,
  };
}

interface PendingRefundBasis {
  refundId: string;
  amountCents: number;
}

async function pendingRefundBasis(
  client: SqlClient,
  orderId: string,
): Promise<PendingRefundBasis[]> {
  return (
    await client.query<PendingRefundBasis>(
      `SELECT id AS "refundId",amount_cents AS "amountCents" FROM app.order_refunds WHERE order_id=$1 AND status='PENDING' ORDER BY id`,
      [orderId],
    )
  ).rows;
}

async function editBalanceContext(client: SqlClient, orderId: string) {
  return (
    await client.query<{
      total: number;
      paid: number;
      amount_due_cents: number;
      refundable_adjustment_cents: number;
      attributed: boolean;
      balance_revision_id: string | null;
      legacy_revision_id: string | null;
    }>(
      `SELECT (orders.pricing_snapshot->>'totalCents')::int AS total,orders.amount_due_cents,orders.refundable_adjustment_cents,
       (CASE WHEN payment.status='SUCCEEDED' THEN payment.amount_cents ELSE 0 END
        + COALESCE((SELECT sum(amount_cents) FROM app.order_payment_captures WHERE order_id=$1),0)
        - COALESCE((SELECT sum(amount_cents) FROM app.order_refunds WHERE order_id=$1 AND status IN ('PENDING','SUCCEEDED')),0))::int AS paid,
       EXISTS (SELECT 1 FROM app.order_operational_audits WHERE order_id=$1 AND action='order_edit_balance_revised' AND metadata->>'revisionId'=orders.financial_snapshot->>'editBalanceRevisionId') AS attributed,
       orders.financial_snapshot->>'editBalanceRevisionId' AS balance_revision_id,
       (SELECT revision.id FROM app.order_revisions revision WHERE revision.order_id=$1 AND (
         revision.before_snapshot->'order'->'pricing_snapshot' IS DISTINCT FROM revision.after_snapshot->'order'->'pricing_snapshot'
         OR COALESCE((revision.after_snapshot->'order'->>'amount_due_cents')::int,0)>0
         OR COALESCE((revision.after_snapshot->'order'->>'refundable_adjustment_cents')::int,0)>0)
        ORDER BY revision.created_at DESC,revision.id DESC LIMIT 1) AS legacy_revision_id
     FROM app.orders orders JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id WHERE orders.id=$1`,
      [orderId],
    )
  ).rows[0];
}

/** Explicit revision/refund identity bindings use the existing append-only audit ledger. */
export async function recordEditedOrderBalanceWithClient(
  client: SqlClient,
  orderId: string,
  input: {
    revisionId: string;
    priceDifferenceCents: number;
    amountDueCents: number;
    refundableAdjustmentCents: number;
    pendingRefunds: PendingRefundBasis[];
    imported?: boolean;
  },
  staffMemberId: string | null,
) {
  await client.query(
    `INSERT INTO app.order_operational_audits (order_id,action,actor_type,actor_staff_member_id,metadata)
    VALUES ($1,'order_edit_balance_revised',$2,$3,$4::jsonb)`,
    [
      orderId,
      staffMemberId ? 'OPS' : 'SYSTEM',
      staffMemberId,
      JSON.stringify({ version: 1, ...input }),
    ],
  );
}

async function importLegacyEditBalanceBasis(client: SqlClient, orderId: string) {
  const context = await editBalanceContext(client, orderId);
  if (!context || context.attributed || !context.legacy_revision_id) return;
  if ((await pendingRefundBasis(client, orderId)).length)
    throw new EditedOrderBalanceAttributionError(
      'This legacy edited order has unattributed pending refunds. Reconcile their edit responsibility before continuing.',
    );
  // Do not rewrite historical snapshots or infer settlement from refund reason/status.
  // Adopt only a settled opening responsibility; ambiguous pending records need review.
  await client.query(
    `UPDATE app.orders SET financial_snapshot=jsonb_set(financial_snapshot,'{editBalanceRevisionId}',to_jsonb($2::text)),updated_at=now() WHERE id=$1`,
    [orderId, context.legacy_revision_id],
  );
  await recordEditedOrderBalanceWithClient(
    client,
    orderId,
    {
      revisionId: context.legacy_revision_id,
      priceDifferenceCents: 0,
      amountDueCents: context.amount_due_cents,
      refundableAdjustmentCents: context.refundable_adjustment_cents,
      pendingRefunds: [],
      imported: true,
    },
    null,
  );
}

async function reserveEditRefundSettlement(
  client: SqlClient,
  orderId: string,
  amountCents: number,
) {
  const context = await editBalanceContext(client, orderId);
  const allocated = context?.attributed
    ? Math.min(context.refundable_adjustment_cents, amountCents)
    : 0;
  if (allocated > 0)
    await client.query(
      'UPDATE app.orders SET refundable_adjustment_cents=refundable_adjustment_cents-$2,updated_at=now() WHERE id=$1',
      [orderId, allocated],
    );
  return {
    amountCents: allocated,
    revisionId: allocated > 0 ? context!.balance_revision_id : null,
  };
}

async function restoreFailedEditRefundSettlement(
  client: SqlClient,
  orderId: string,
  refundId: string,
) {
  const result = (
    await client.query<{ amount: number }>(
      `SELECT COALESCE(sum(amount),0)::int AS amount FROM (
       SELECT (metadata->'editSettlement'->>'amountCents')::int AS amount FROM app.order_operational_audits
       WHERE order_id=$1 AND action='refund_requested' AND metadata->>'refundId'=$2
       UNION ALL
       SELECT (pending->>'amountCents')::int FROM app.order_operational_audits audit
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(audit.metadata->'pendingRefunds','[]'::jsonb)) pending
       WHERE audit.order_id=$1 AND audit.action='order_edit_balance_revised' AND pending->>'refundId'=$2
     ) responsibility`,
      [orderId, refundId],
    )
  ).rows[0]!.amount;
  if (!result) return;
  await client.query(
    `UPDATE app.orders SET amount_due_cents=GREATEST(0,amount_due_cents-refundable_adjustment_cents-$2),
    refundable_adjustment_cents=GREATEST(0,refundable_adjustment_cents-amount_due_cents+$2),updated_at=now() WHERE id=$1`,
    [orderId, result],
  );
}

async function lockRefundOrder(client: SqlClient, orderId: string) {
  // The row lock is first, matching admin edits and Order→Groups operations.
  await client.query('SELECT id FROM app.orders WHERE id=$1 FOR UPDATE', [orderId]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orderId]);
}

/** Refund reservations share one order lock across both destinations, independent of fulfillment. */
export class OrderRefundService {
  constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
    private readonly analytics?: RefundAnalytics,
  ) {}

  /** Reconcile an already-reserved authorized refund through a provider read; never repeat payment. */
  async recoverRefundResult(
    actor: RefundActor,
    input: RefundOrderInput,
  ): Promise<RefundOrderResult | null> {
    this.validate(actor, input);
    await this.requireActor(actor);
    const found = await this.pool.query<RefundReconciliationRow>(
      `SELECT refund.* FROM app.order_refunds refund
       JOIN app.orders orders ON orders.id=refund.order_id
       WHERE orders.order_number=$1 AND refund.idempotency_key=$2`,
      [input.orderNumber, input.idempotencyKey],
    );
    const refund = found.rows[0];
    if (!refund) return null;
    return this.reconcilePersistedRefund(actor, input.orderNumber, refund);
  }

  /**
   * Reconcile a persisted ORIGINAL_PAYMENT refund selected from Order Detail.
   * The recovery key belongs only to this read-only provider check; provider discovery
   * always uses the original refund key stored in the database.
   */
  async reconcileRefund(
    actor: RefundActor,
    input: ReconcileRefundInput,
  ): Promise<RefundOrderResult | null> {
    this.validateReconciliation(actor, input);
    await this.requireActor(actor);
    const found = await this.pool.query<RefundReconciliationRow>(
      `SELECT refund.* FROM app.order_refunds refund
       JOIN app.orders orders ON orders.id=refund.order_id
       WHERE orders.order_number=$1 AND refund.id=$2 AND refund.destination='ORIGINAL_PAYMENT'`,
      [input.orderNumber, input.refundId],
    );
    const refund = found.rows[0];
    if (!refund) return null;
    return this.reconcilePersistedRefund(actor, input.orderNumber, refund);
  }

  private async reconcilePersistedRefund(
    actor: RefundActor,
    orderNumber: string,
    refund: RefundReconciliationRow,
  ): Promise<RefundOrderResult> {
    if (refund.status !== 'PENDING' || refund.destination !== 'ORIGINAL_PAYMENT')
      return result(refund, true);
    const allocations = await this.refundAllocations(refund.id);
    if (allocations.length)
      return this.reconcileAllocatedRefund(actor, orderNumber, refund, allocations);
    const persistedInput: RefundOrderInput = {
      orderNumber,
      amountCents: refund.amount_cents,
      reasonCode: refund.reason_code,
      ...(refund.notes === null ? {} : { note: refund.notes }),
      idempotencyKey: refund.idempotency_key,
    };
    let provider: PaymentRefundResult;
    try {
      if (refund.provider_refund_id && this.payments.getRefundStatus)
        provider = await this.payments.getRefundStatus({
          providerRefundId: refund.provider_refund_id,
          providerPaymentId: (
            await this.pool.query<{ provider_payment_id: string }>(
              `SELECT payment.provider_payment_id FROM app.payments payment
               JOIN app.order_refunds stored ON stored.payment_id=payment.id WHERE stored.id=$1`,
              [refund.id],
            )
          ).rows[0]!.provider_payment_id,
          amountCents: refund.amount_cents,
        });
      else if (!refund.provider_refund_id && this.payments.findRefund) {
        const foundProvider = await this.payments.findRefund({
          providerPaymentId: (
            await this.pool.query<{ provider_payment_id: string }>(
              `SELECT payment.provider_payment_id FROM app.payments payment
               JOIN app.order_refunds stored ON stored.payment_id=payment.id WHERE stored.id=$1`,
              [refund.id],
            )
          ).rows[0]!.provider_payment_id,
          amountCents: refund.amount_cents,
          idempotencyKey: refund.idempotency_key,
        });
        if (!foundProvider) return result(refund, true);
        provider = foundProvider;
      } else return result(refund, true);
    } catch {
      return result(refund, true);
    }
    let identified: RefundRow = refund;
    if (!refund.provider_refund_id) {
      identified = await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, refund.order_id);
        const updated = await client.query<RefundRow>(
          `UPDATE app.order_refunds SET provider_refund_id=$2
           WHERE id=$1 AND status='PENDING' AND provider_refund_id IS NULL RETURNING *`,
          [refund.id, provider.providerRefundId],
        );
        const current =
          updated.rows[0] ??
          (
            await client.query<RefundRow>('SELECT * FROM app.order_refunds WHERE id=$1', [
              refund.id,
            ])
          ).rows[0];
        if (!current || current.provider_refund_id !== provider.providerRefundId)
          throw new PaymentRefundUncertainError();
        return current;
      });
    }
    if (provider.status === 'PENDING') return result(identified, true);
    const reconciled = await withTransaction(this.pool, async (client) => {
      await lockRefundOrder(client, refund.order_id);
      const updated = await client.query<RefundRow>(
        `UPDATE app.order_refunds SET status=$2,completed_at=now()
         WHERE id=$1 AND status='PENDING' AND provider_refund_id=$3 RETURNING *`,
        [refund.id, provider.status, provider.providerRefundId],
      );
      if (!updated.rows[0]) {
        return (
          await client.query<RefundRow>('SELECT * FROM app.order_refunds WHERE id=$1', [refund.id])
        ).rows[0]!;
      }
      if (provider.status === 'FAILED') {
        await importLegacyEditBalanceBasis(client, refund.order_id);
        await restoreFailedEditRefundSettlement(client, refund.order_id, refund.id);
      }
      await this.audit(
        client,
        refund.order_id,
        provider.status === 'SUCCEEDED' ? 'refund_succeeded' : 'refund_failed',
        actor,
        persistedInput,
        {
          refundId: refund.id,
          amountCents: refund.amount_cents,
          providerRefundId: provider.providerRefundId,
          providerStatus: provider.providerStatus,
          reconciled: true,
        },
      );
      return updated.rows[0];
    });
    if (provider.status === 'SUCCEEDED')
      await this.emitRefund(this.pool, refund.order_id, persistedInput);
    return result(reconciled, true);
  }

  async refundOriginalPayment(
    actor: RefundActor,
    input: RefundOrderInput,
  ): Promise<RefundOrderResult> {
    this.validate(actor, input);
    await this.requireActor(actor);
    const reservation = await withTransaction(this.pool, (client) =>
      this.reserve(client, actor, input, 'ORIGINAL_PAYMENT'),
    );
    if (reservation.duplicate) {
      if (reservation.refund.status === 'PENDING')
        return (await this.recoverRefundResult(actor, input)) ?? result(reservation.refund, true);
      return result(reservation.refund, true);
    }

    if (reservation.allocations.length)
      return this.submitAllocatedRefund(
        actor,
        input,
        reservation.order.id,
        reservation.refund,
        reservation.allocations,
      );

    let provider: PaymentRefundSubmissionResult;
    try {
      provider = await this.payments.refund({
        providerPaymentId: reservation.order.provider_payment_id,
        amountCents: reservation.refund.amount_cents,
        idempotencyKey: input.idempotencyKey,
      });
      if (!['PENDING', 'SUCCEEDED'].includes(provider.status as string))
        throw new PaymentRefundRejectedError();
    } catch (error) {
      if (!(error instanceof PaymentRefundRejectedError)) {
        // The provider may already have refunded money. Retain both the monetary
        // reservation and edit allocation; replay is read-only, even with a new key.
        await withTransaction(this.pool, async (client) => {
          await lockRefundOrder(client, reservation.order.id);
          await this.audit(client, reservation.order.id, 'refund_outcome_unknown', actor, input, {
            refundId: reservation.refund.id,
            amountCents: reservation.refund.amount_cents,
            destination: 'ORIGINAL_PAYMENT',
            result: 'PENDING',
          });
        });
        throw new PaymentRefundUncertainError();
      }
      await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, reservation.order.id);
        await importLegacyEditBalanceBasis(client, reservation.order.id);
        const failed = await client.query(
          `UPDATE app.order_refunds SET status='FAILED', completed_at=now() WHERE id=$1 AND status='PENDING' RETURNING id`,
          [reservation.refund.id],
        );
        if (failed.rows.length)
          await restoreFailedEditRefundSettlement(
            client,
            reservation.order.id,
            reservation.refund.id,
          );
      });
      throw error;
    }

    // Persist provider identity before terminal finalization so a later audit/database
    // failure remains recoverable through a read-only provider lookup.
    const identified = await withTransaction(this.pool, async (client) => {
      await lockRefundOrder(client, reservation.order.id);
      const updated = await client.query<RefundRow>(
        `UPDATE app.order_refunds SET provider_refund_id=$2
         WHERE id=$1 AND status='PENDING' RETURNING *`,
        [reservation.refund.id, provider.providerRefundId],
      );
      const refund = updated.rows[0];
      if (!refund) throw new Error('Refund reservation is unavailable.');
      return refund;
    });
    if (provider.status === 'PENDING') {
      await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, reservation.order.id);
        await this.audit(client, reservation.order.id, 'refund_pending', actor, input, {
          amountCents: identified.amount_cents,
          providerRefundId: provider.providerRefundId,
          providerStatus: provider.providerStatus,
        });
      });
      return result(identified, false);
    }
    const completed = await withTransaction(this.pool, async (client) => {
      await lockRefundOrder(client, reservation.order.id);
      const updated = await client.query<RefundRow>(
        `UPDATE app.order_refunds SET status='SUCCEEDED',completed_at=now()
         WHERE id=$1 AND status='PENDING' AND provider_refund_id=$2 RETURNING *`,
        [reservation.refund.id, provider.providerRefundId],
      );
      const refund = updated.rows[0];
      if (!refund) throw new Error('Refund reservation is unavailable.');
      await this.audit(client, reservation.order.id, 'refund_succeeded', actor, input, {
        amountCents: refund.amount_cents,
        providerRefundId: provider.providerRefundId,
        providerStatus: provider.providerStatus,
      });
      return refund;
    });
    if (provider.status === 'SUCCEEDED')
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
      await this.audit(client, order.id, 'refund_succeeded', actor, input, {
        amountCents,
        destination: 'STORE_CREDIT',
        storeCreditLedgerEntryId: adjustment.entryId,
      });
      await this.emitRefund(client, order.id, input, 'STORE_CREDIT');
      return result(refund, false);
    });
  }

  private async refundAllocations(
    refundId: string,
    client: SqlClient | SqlPool = this.pool,
  ): Promise<RefundAllocationRow[]> {
    return (
      await client.query<RefundAllocationRow>(
        'SELECT * FROM app.order_refund_allocations WHERE order_refund_id=$1 ORDER BY id',
        [refundId],
      )
    ).rows;
  }

  private async submitAllocatedRefund(
    actor: RefundActor,
    input: RefundOrderInput,
    orderId: string,
    refund: RefundRow,
    allocations: RefundAllocationRow[],
  ): Promise<RefundOrderResult> {
    let definitiveFailure: PaymentRefundRejectedError | null = null;
    for (const allocation of allocations) {
      if (allocation.status !== 'PENDING') continue;
      let provider: PaymentRefundSubmissionResult;
      try {
        provider = await this.payments.refund({
          providerPaymentId: allocation.provider_payment_id,
          amountCents: allocation.amount_cents,
          idempotencyKey: allocation.idempotency_key,
        });
        if (!['PENDING', 'SUCCEEDED'].includes(provider.status))
          throw new PaymentRefundRejectedError();
      } catch (error) {
        if (!(error instanceof PaymentRefundRejectedError)) {
          await this.audit(this.pool, orderId, 'refund_outcome_unknown', actor, input, {
            refundId: refund.id,
            allocationId: allocation.id,
            amountCents: allocation.amount_cents,
            destination: 'ORIGINAL_PAYMENT',
            result: 'PENDING',
          });
          throw new PaymentRefundUncertainError();
        }
        definitiveFailure = error;
        await withTransaction(this.pool, async (client) => {
          await lockRefundOrder(client, orderId);
          await client.query(
            `UPDATE app.order_refund_allocations SET status='FAILED',completed_at=now()
             WHERE id=$1 AND status='PENDING'`,
            [allocation.id],
          );
        });
        continue;
      }
      await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, orderId);
        if (allocations.length === 1) {
          const identified = await client.query(
            `UPDATE app.order_refunds SET provider_refund_id=$2
             WHERE id=$1 AND status='PENDING'
               AND (provider_refund_id IS NULL OR provider_refund_id=$2)
             RETURNING id`,
            [refund.id, provider.providerRefundId],
          );
          if (!identified.rows[0]) throw new PaymentRefundUncertainError();
        }
        await client.query(
          `UPDATE app.order_refund_allocations
           SET provider_refund_id=$2,status=$3,completed_at=CASE WHEN $3='SUCCEEDED' THEN now() ELSE NULL END
           WHERE id=$1 AND status='PENDING'`,
          [allocation.id, provider.providerRefundId, provider.status],
        );
      });
    }
    const completed = await this.finalizeAllocatedRefund(actor, input, orderId, refund.id);
    if (definitiveFailure) {
      if (completed.status === 'FAILED') throw definitiveFailure;
      throw new PaymentRefundUncertainError();
    }
    return result(completed, false);
  }

  private async reconcileAllocatedRefund(
    actor: RefundActor,
    orderNumber: string,
    refund: RefundReconciliationRow,
    allocations: RefundAllocationRow[],
  ): Promise<RefundOrderResult> {
    const persistedInput: RefundOrderInput = {
      orderNumber,
      amountCents: refund.amount_cents,
      reasonCode: refund.reason_code,
      ...(refund.notes === null ? {} : { note: refund.notes }),
      idempotencyKey: refund.idempotency_key,
    };
    for (const allocation of allocations) {
      if (allocation.status !== 'PENDING') continue;
      let provider: PaymentRefundResult | null = null;
      try {
        provider = allocation.provider_refund_id
          ? ((await this.payments.getRefundStatus?.({
              providerRefundId: allocation.provider_refund_id,
              providerPaymentId: allocation.provider_payment_id,
              amountCents: allocation.amount_cents,
            })) ?? null)
          : ((await this.payments.findRefund?.({
              providerPaymentId: allocation.provider_payment_id,
              amountCents: allocation.amount_cents,
              idempotencyKey: allocation.idempotency_key,
            })) ?? null);
      } catch {
        provider = null;
      }
      if (!provider) continue;
      await withTransaction(this.pool, async (client) => {
        await lockRefundOrder(client, refund.order_id);
        await client.query(
          `UPDATE app.order_refund_allocations SET provider_refund_id=$2,status=$3,
           completed_at=CASE WHEN $3 IN ('SUCCEEDED','FAILED') THEN now() ELSE NULL END
           WHERE id=$1 AND status='PENDING'`,
          [allocation.id, provider.providerRefundId, provider.status],
        );
      });
    }
    return result(
      await this.finalizeAllocatedRefund(actor, persistedInput, refund.order_id, refund.id),
      true,
    );
  }

  private async finalizeAllocatedRefund(
    actor: RefundActor,
    input: RefundOrderInput,
    orderId: string,
    refundId: string,
  ): Promise<RefundRow> {
    const finalized = await withTransaction(this.pool, async (client) => {
      await lockRefundOrder(client, orderId);
      const allocations = await this.refundAllocations(refundId, client);
      const allSucceeded =
        allocations.length > 0 && allocations.every((row) => row.status === 'SUCCEEDED');
      const allFailed =
        allocations.length > 0 && allocations.every((row) => row.status === 'FAILED');
      const status: RefundOrderResult['status'] = allSucceeded
        ? 'SUCCEEDED'
        : allFailed
          ? 'FAILED'
          : 'PENDING';
      const providerRefundId = allocations.length === 1 ? allocations[0]!.provider_refund_id : null;
      let updated: RefundRow;
      if (allSucceeded) {
        updated = (
          await client.query<RefundRow>(
            `UPDATE app.order_refunds SET status='SUCCEEDED',
             provider_refund_id=COALESCE(provider_refund_id,$2),completed_at=now()
             WHERE id=$1 AND status='PENDING' RETURNING *`,
            [refundId, providerRefundId],
          )
        ).rows[0]!;
      } else if (allFailed) {
        updated = (
          await client.query<RefundRow>(
            `UPDATE app.order_refunds SET status='FAILED',completed_at=now()
             WHERE id=$1 AND status='PENDING' RETURNING *`,
            [refundId],
          )
        ).rows[0]!;
      } else {
        updated = (
          await client.query<RefundRow>(
            `UPDATE app.order_refunds SET provider_refund_id=COALESCE(provider_refund_id,$2)
             WHERE id=$1 AND status='PENDING' RETURNING *`,
            [refundId, providerRefundId],
          )
        ).rows[0]!;
      }
      updated ??= (
        await client.query<RefundRow>('SELECT * FROM app.order_refunds WHERE id=$1', [refundId])
      ).rows[0]!;
      if (allFailed) {
        await importLegacyEditBalanceBasis(client, orderId);
        await restoreFailedEditRefundSettlement(client, orderId, refundId);
      }
      if (allSucceeded)
        await this.audit(client, orderId, 'refund_succeeded', actor, input, {
          amountCents: updated.amount_cents,
          allocations: allocations.map((allocation) => ({
            allocationId: allocation.id,
            providerRefundId: allocation.provider_refund_id,
            amountCents: allocation.amount_cents,
          })),
        });
      return updated;
    });
    if (finalized.status === 'SUCCEEDED') await this.emitRefund(this.pool, orderId, input);
    return finalized;
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

  private validateReconciliation(actor: RefundActor, input: ReconcileRefundInput) {
    if (
      (actor.type !== 'STAFF' && actor.type !== 'USER') ||
      (actor.type === 'STAFF' && actor.role !== 'OWNER' && actor.role !== 'OPERATIONS') ||
      (actor.type === 'USER' && !actor.userId)
    )
      throw new Error('Operations access is restricted.');
    if (typeof input.orderNumber !== 'string' || !input.orderNumber.trim())
      throw new Error('Order is unavailable.');
    if (
      typeof input.refundId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.refundId,
      )
    )
      throw new Error('Refund is unavailable.');
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim().length < 12 ||
      input.idempotencyKey.length > 120
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
      return {
        order,
        refund: existing.rows[0],
        allocations: await this.refundAllocations(existing.rows[0].id, client),
        duplicate: true,
      };
    }
    const activeAdditionalPayment = await client.query(
      `SELECT id FROM app.order_edit_payment_attempts
       WHERE order_id=$1 AND (status IN ('PREPARING','PENDING')
         OR (status='FAILED' AND provider_payment_id IS NOT NULL))
       ORDER BY id FOR UPDATE`,
      [order.id],
    );
    if (activeAdditionalPayment.rows.length)
      throw new Error('An additional payment is active for this order.');
    const supplementalCaptured = await client.query<{ amount: string }>(
      'SELECT coalesce(sum(amount_cents),0)::text AS amount FROM app.order_payment_captures WHERE order_id=$1',
      [order.id],
    );
    const capturedCents = order.amount_cents + Number(supplementalCaptured.rows[0]?.amount ?? 0);
    const prior = await client.query<{ amount: string }>(
      `SELECT coalesce(sum(amount_cents),0)::text AS amount FROM app.order_refunds
       WHERE order_id=$1 AND status IN ('PENDING','SUCCEEDED')`,
      [order.id],
    );
    if (Number(prior.rows[0]?.amount ?? 0) + input.amountCents > capturedCents)
      throw new Error('Refund exceeds the captured payment.');
    await importLegacyEditBalanceBasis(client, order.id);
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
    const editSettlement = await reserveEditRefundSettlement(client, order.id, input.amountCents);
    const allocations =
      destination === 'ORIGINAL_PAYMENT'
        ? await this.allocateCapturedPayments(client, order, refund, input.amountCents)
        : [];
    await this.audit(client, order.id, 'refund_requested', actor, input, {
      refundId: refund.id,
      editSettlement,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      ...(destination === 'STORE_CREDIT' ? { destination } : {}),
    });
    return { order, refund, allocations, duplicate: false };
  }

  private async allocateCapturedPayments(
    client: SqlClient,
    order: PaidOrderRow,
    refund: RefundRow,
    requestedCents: number,
  ): Promise<RefundAllocationRow[]> {
    const sources = (
      await client.query<{
        source_type: 'CHECKOUT' | 'ORDER_EDIT';
        source_id: string;
        provider: 'FAKE' | 'STRIPE';
        provider_payment_id: string;
        currency: 'USD';
        available_cents: number;
      }>(
        `WITH sources AS (
          SELECT 'ORDER_EDIT'::text source_type,capture.id source_id,capture.provider,
                 capture.provider_payment_id,capture.currency,capture.amount_cents,capture.captured_at
          FROM app.order_payment_captures capture WHERE capture.order_id=$1
          UNION ALL
          SELECT 'CHECKOUT',payment.id,payment.provider,payment.provider_payment_id,payment.currency,
                 payment.amount_cents,payment.created_at
          FROM app.payments payment JOIN app.orders orders ON orders.checkout_attempt_id=payment.checkout_attempt_id
          WHERE orders.id=$1 AND payment.status='SUCCEEDED'
        )
        SELECT source_type,source_id,provider,provider_payment_id,currency,
          (amount_cents-COALESCE((SELECT sum(allocation.amount_cents)
            FROM app.order_refund_allocations allocation
            WHERE allocation.status IN ('PENDING','SUCCEEDED') AND
              ((source_type='CHECKOUT' AND allocation.checkout_payment_id=source_id)
               OR (source_type='ORDER_EDIT' AND allocation.order_payment_capture_id=source_id))),0))::int available_cents
        FROM sources ORDER BY captured_at DESC,source_id`,
        [order.id],
      )
    ).rows;
    let remaining = requestedCents;
    const selected: Array<{ source: (typeof sources)[number]; amount: number }> = [];
    for (const source of sources) {
      const amount = Math.min(remaining, source.available_cents);
      if (amount <= 0) continue;
      selected.push({ source, amount });
      remaining -= amount;
      if (remaining === 0) break;
    }
    if (remaining !== 0) throw new Error('Refund exceeds available captured payments.');
    const allocations: RefundAllocationRow[] = [];
    for (const [index, selection] of selected.entries()) {
      const { source, amount } = selection;
      const inserted = (
        await client.query<RefundAllocationRow>(
          `INSERT INTO app.order_refund_allocations
           (order_refund_id,order_id,checkout_payment_id,order_payment_capture_id,provider,
            provider_payment_id,amount_cents,currency,status,idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9) RETURNING *`,
          [
            refund.id,
            order.id,
            source.source_type === 'CHECKOUT' ? source.source_id : null,
            source.source_type === 'ORDER_EDIT' ? source.source_id : null,
            source.provider,
            source.provider_payment_id,
            amount,
            source.currency,
            selected.length === 1 ? refund.idempotency_key : `${refund.id}:capture:${index + 1}`,
          ],
        )
      ).rows[0]!;
      allocations.push(inserted);
    }
    return allocations;
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
