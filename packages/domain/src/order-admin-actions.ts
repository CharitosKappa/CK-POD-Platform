import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  AdminCommerceValidationError,
  adminOrderLayerSql,
  type AdminStaffSession,
} from './admin-commerce';
import {
  resolveOrderActionEligibility,
  type CancellationStatus,
  type RefundDestination,
  type OrderActionEligibility,
} from './order-admin-actions-contracts';
import {
  projectPaymentState,
  type FulfillmentState,
  type PaymentStateEvidence,
  type PrintingGroupState,
} from './order-detail-contracts';
import { OrderOperationsAccessError, type OrderOperationsService } from './order-operations';
import { normalizeFulfillmentError, type FulfillmentService } from './fulfillment-contracts';
import type { OrderRefundService } from './order-refunds';
import { LifecycleOrchestrator } from './operations-analytics';

export class OrderAdminActionAccessError extends OrderOperationsAccessError {}
export class OrderAdminActionValidationError extends AdminCommerceValidationError {}
export class OrderAdminActionNotFoundError extends Error {}
export class OrderAdminActionConflictError extends Error {
  constructor(
    message: string,
    public readonly eligibility?: OrderActionEligibility,
  ) {
    super(message);
  }
}

export interface ArchiveOrderInput {
  orderNumber: string;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}

export interface ArchiveResult {
  orderId: string;
  archived: boolean;
  archivedAt: Date | null;
  duplicate: boolean;
}

export interface CancelOrderInput {
  orderNumber: string;
  refundDestination: RefundDestination;
  refundAmountCents: number;
  reasonCode: string;
  staffNote?: string;
  notifyCustomer: boolean;
  idempotencyKey: string;
}

export interface CancelOrderResult {
  cancellationId: string;
  status: CancellationStatus;
  orderStatus: string;
  unresolvedFulfillmentGroupIds: string[];
  duplicate: boolean;
  refund: {
    destination: RefundDestination;
    amountCents: number;
    status: 'LATER' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
    refundId: string | null;
    retryable: boolean;
  };
}

export interface RetryCancellationInput {
  orderNumber: string;
  cancellationId: string;
  idempotencyKey: string;
}

export interface OrderAdminActionsDependencies {
  fulfillment: FulfillmentService;
  operations: OrderOperationsService;
  refunds: OrderRefundService;
  lifecycle?: LifecycleOrchestrator;
}

interface CancellationRow {
  id: string;
  order_id: string;
  status: CancellationStatus;
  refund_destination: RefundDestination;
  refund_amount_cents: number;
  reason_code: string;
  staff_note: string | null;
  notify_customer: boolean;
}

interface CancellationGroupRow {
  id: string;
  fulfillment_group_id: string;
  external_order_id: string | null;
  status: 'REQUESTED' | 'CANCELLED' | 'NOT_REQUIRED' | 'UNAVAILABLE' | 'FAILED';
}

interface LockedOrder {
  id: string;
  status: string;
  archived_at: Date | null;
  archived_by_staff_member_id: string | null;
}

interface StoredArchiveResult {
  orderId: string;
  archived: boolean;
  archivedAt: string | null;
}

/** Staff action boundary. Archive changes organization metadata only. */
export class OrderAdminActionsService {
  constructor(
    private readonly pool: SqlPool,
    private readonly dependencies?: OrderAdminActionsDependencies,
  ) {}

  async archive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, true);
  }

  async unarchive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, false);
  }

  async cancel(session: AdminStaffSession, input: CancelOrderInput): Promise<CancelOrderResult> {
    this.validate(session, {
      ...input,
      ...(input.staffNote === undefined ? {} : { note: input.staffNote }),
    });
    if (
      !['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'LATER'].includes(input.refundDestination) ||
      !Number.isSafeInteger(input.refundAmountCents) ||
      input.refundAmountCents < 0 ||
      (input.refundDestination === 'LATER'
        ? input.refundAmountCents !== 0
        : input.refundAmountCents === 0) ||
      typeof input.notifyCustomer !== 'boolean'
    ) {
      throw new OrderAdminActionValidationError(
        'Provide a valid refund destination, amount, and notification choice.',
      );
    }
    return this.runCancellation(session, input);
  }

  async retryCancellation(
    session: AdminStaffSession,
    input: RetryCancellationInput,
  ): Promise<CancelOrderResult> {
    this.validate(session, { ...input, reasonCode: 'CUSTOMER_CANCELLATION_REQUEST' });
    if (
      typeof input.cancellationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.cancellationId)
    ) {
      throw new OrderAdminActionValidationError('Provide a valid cancellation identifier.');
    }
    return this.runCancellation(session, input);
  }

  private async runCancellation(
    session: AdminStaffSession,
    input: CancelOrderInput | RetryCancellationInput,
  ): Promise<CancelOrderResult> {
    const dependencies = this.dependencies;
    if (!dependencies) throw new Error('Cancellation services are not configured.');
    const lifecycle = dependencies.lifecycle ?? new LifecycleOrchestrator(this.pool);
    const client = await this.pool.connect();
    let workerLock: string | undefined;
    try {
      const reservation = await transactionOn(client, async () => {
        const order = await this.lockOrder(client, input.orderNumber);
        const retry = 'cancellationId' in input;
        const action = retry ? 'order_cancellation_retried' : 'order_cancellation_requested';
        const existing = await this.existingAction<{ cancellationId: string }>(
          client,
          order.id,
          action,
          input.idempotencyKey,
        );
        if (retry && existing && existing.cancellationId !== input.cancellationId)
          throw new OrderAdminActionConflictError(
            'Idempotency key belongs to another cancellation.',
          );
        const eligibility = await this.loadEligibility(client, session, order);
        const found = await client.query<CancellationRow>(
          `SELECT * FROM app.order_cancellations WHERE order_id=$1 ORDER BY created_at,id FOR UPDATE`,
          [order.id],
        );
        let cancellation = found.rows[0];
        if (retry && (!cancellation || cancellation.id !== input.cancellationId))
          throw new OrderAdminActionNotFoundError('Cancellation not found for this order.');
        if (!retry && cancellation && !existing)
          throw new OrderAdminActionConflictError(
            'This order already has a cancellation. Retry that cancellation.',
          );
        if (
          cancellation &&
          (cancellation.status === 'SUCCEEDED' ||
            (existing && cancellation.status !== 'PROCESSING'))
        )
          return { cancellation, execute: false, duplicate: true };

        // A session lock spans external calls without holding a business transaction open.
        // It is shared by every process and released on connection loss; persisted REQUESTED
        // attempts can then be reconciled using the same provider key, without a lease race.
        const key = `order-cancellation:${order.id}`;
        const claim = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
          [key],
        );
        if (!claim.rows[0]?.acquired) {
          if (!cancellation)
            throw new OrderAdminActionConflictError('Cancellation is already in progress.');
          return { cancellation, execute: false, duplicate: true };
        }
        workerLock = key;
        // Recovery still finalizes previously confirmed provider work if newer evidence
        // prevents further cancellation. Each unresolved provider claim revalidates below.
        if (!eligibility.actions.cancel && cancellation?.status !== 'PROCESSING')
          throw new OrderAdminActionConflictError(
            'This order is not eligible for cancellation.',
            eligibility,
          );
        const active = await client.query(
          `SELECT id FROM app.order_fulfillment_actions
          WHERE order_id=$1 AND status='PROCESSING'`,
          [order.id],
        );
        if (active.rows.length)
          throw new OrderAdminActionConflictError(
            'An external fulfillment action is in progress.',
            eligibility,
          );
        if (!cancellation) {
          if (retry) throw new OrderAdminActionNotFoundError('Cancellation not found.');
          const legacy = (
            await client.query<{ external_order_id: string }>(
              'SELECT external_order_id FROM app.external_fulfillment_orders WHERE order_id=$1',
              [order.id],
            )
          ).rows[0];
          const groups = (
            await client.query<{ id: string; external_order_id: string | null }>(
              'SELECT id,external_order_id FROM app.order_fulfillment_groups WHERE order_id=$1 ORDER BY id',
              [order.id],
            )
          ).rows;
          if (
            legacy &&
            !groups.some((group) => group.external_order_id === legacy.external_order_id) &&
            (groups.length !== 1 || groups[0]!.external_order_id !== null)
          )
            throw new OrderAdminActionConflictError(
              'The legacy provider order must be linked to its fulfillment group.',
            );
          cancellation = (
            await client.query<CancellationRow>(
              `INSERT INTO app.order_cancellations (order_id,status,refund_destination,refund_amount_cents,
             reason_code,staff_note,notify_customer,initiated_by_staff_member_id,idempotency_key)
             VALUES ($1,'PROCESSING',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                order.id,
                input.refundDestination,
                input.refundAmountCents,
                input.reasonCode,
                input.staffNote ?? null,
                input.notifyCustomer,
                session.staffMemberId,
                input.idempotencyKey,
              ],
            )
          ).rows[0]!;
          await client.query(
            `INSERT INTO app.order_cancellation_groups
            (order_cancellation_id,fulfillment_group_id,external_order_id,status)
            SELECT $1,id,COALESCE(external_order_id,$3),CASE WHEN COALESCE(external_order_id,$3) IS NULL THEN 'NOT_REQUIRED' ELSE 'REQUESTED' END
            FROM app.order_fulfillment_groups WHERE order_id=$2 ORDER BY id`,
            [
              cancellation.id,
              order.id,
              groups.length === 1 ? (legacy?.external_order_id ?? null) : null,
            ],
          );
        } else {
          await client.query(
            `UPDATE app.order_cancellations SET status='PROCESSING',failure_reason=NULL,
            completed_at=NULL,updated_at=now() WHERE id=$1`,
            [cancellation.id],
          );
          cancellation.status = 'PROCESSING';
        }
        if (!existing)
          await this.audit(
            client,
            session,
            order.id,
            action,
            {
              orderNumber: input.orderNumber,
              idempotencyKey: input.idempotencyKey,
              reasonCode: cancellation.reason_code,
              ...(cancellation.staff_note === null ? {} : { note: cancellation.staff_note }),
            },
            {
              result: { cancellationId: cancellation.id },
              refundDestination: cancellation.refund_destination,
              refundAmountCents: cancellation.refund_amount_cents,
              notifyCustomer: cancellation.notify_customer,
            },
          );
        return { cancellation, execute: true, duplicate: false };
      });
      const cancellation = reservation.cancellation;
      if (reservation.execute) {
        await this.cancelProviderGroups(
          client,
          session,
          input.orderNumber,
          cancellation,
          dependencies.fulfillment,
        );
        await transactionOn(client, async () => {
          const outcome = await dependencies.operations.finalizeCancellationWithClient(
            client,
            session,
            {
              orderNumber: input.orderNumber,
              cancellationId: cancellation.id,
            },
          );
          await client.query(
            `UPDATE app.order_cancellations SET status=$2,updated_at=now(),completed_at=now(),
            failure_reason=$3 WHERE id=$1`,
            [
              cancellation.id,
              outcome.status,
              outcome.status === 'SUCCEEDED' ? null : 'PROVIDER_CANCELLATION_UNRESOLVED',
            ],
          );
          await client.query(
            `INSERT INTO app.order_operational_audits
            (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata)
            VALUES ($1,'order_cancellation_finalized','OPS',$2,$3,$4::jsonb)`,
            [
              cancellation.order_id,
              session.staffMemberId,
              cancellation.reason_code,
              JSON.stringify({
                cancellationId: cancellation.id,
                note: cancellation.staff_note,
                source: 'ADMIN',
                result: outcome,
                refundDestination: cancellation.refund_destination,
                refundAmountCents: cancellation.refund_amount_cents,
              }),
            ],
          );
          if (outcome.status === 'SUCCEEDED' && cancellation.notify_customer) {
            const customer = (
              await client.query<{ customer_email: string }>(
                'SELECT customer_email FROM app.orders WHERE id=$1',
                [cancellation.order_id],
              )
            ).rows[0]!;
            await lifecycle.enqueueTransactionalWithClient(client, {
              type: 'ORDER_CANCELLATION',
              recipientEmail: customer.customer_email,
              orderId: cancellation.order_id,
              idempotencyKey: `cancellation-notification:${cancellation.id}`,
              payload: {
                cancellationId: cancellation.id,
                orderNumber: input.orderNumber,
                refundDestination: cancellation.refund_destination,
                refundAmountCents: cancellation.refund_amount_cents,
              },
            });
          }
          cancellation.status = outcome.status;
        });
      }
      if (cancellation.status === 'SUCCEEDED') {
        await this.settleCancellationRefund(
          client,
          session,
          input.orderNumber,
          cancellation,
          dependencies.refunds,
        );
        if (cancellation.notify_customer) {
          const delivery = (
            await client.query<{ id: string }>(
              `SELECT id FROM app.lifecycle_deliveries
            WHERE idempotency_key=$1`,
              [`cancellation-notification:${cancellation.id}`],
            )
          ).rows[0];
          if (delivery) await lifecycle.dispatchDelivery(delivery.id);
        }
      }
      return await this.cancellationResult(client, cancellation.id, reservation.duplicate);
    } finally {
      try {
        if (workerLock) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [workerLock]);
      } finally {
        client.release();
      }
    }
  }

  private async settleCancellationRefund(
    client: SqlClient,
    session: AdminStaffSession,
    orderNumber: string,
    cancellation: CancellationRow,
    refunds: OrderRefundService,
  ): Promise<void> {
    if (cancellation.refund_destination === 'LATER') return;
    const receiptKey = `cancellation-refund-result:${cancellation.id}`;
    if (
      (
        await client.query('SELECT id FROM app.order_operational_audits WHERE idempotency_key=$1', [
          receiptKey,
        ])
      ).rows.length
    )
      return;
    const idempotencyKey = `cancellation-refund:${cancellation.id}`;
    let failureReason: string | null = null;
    try {
      const method =
        cancellation.refund_destination === 'STORE_CREDIT'
          ? 'refundToStoreCredit'
          : 'refundOriginalPayment';
      await refunds[method](
        {
          type: 'STAFF',
          staffMemberId: session.staffMemberId,
          role: session.role as 'OWNER' | 'OPERATIONS',
          email: session.email,
        },
        {
          orderNumber,
          amountCents: cancellation.refund_amount_cents,
          reasonCode: 'CANCELLED',
          idempotencyKey,
          ...(cancellation.staff_note === null ? {} : { note: cancellation.staff_note }),
        },
      );
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'Refund operation failed.';
    }
    const refund = (
      await client.query<{ id: string; status: string }>(
        'SELECT id,status FROM app.order_refunds WHERE idempotency_key=$1',
        [idempotencyKey],
      )
    ).rows[0];
    const refundStatus = refund?.status ?? 'FAILED';
    // A PENDING monetary reservation is retained for payment reconciliation, never reissued here.
    if (refundStatus === 'PENDING') return;
    await client.query(
      `INSERT INTO app.order_operational_audits
      (order_id,action,actor_type,actor_staff_member_id,reason_code,idempotency_key,metadata)
      VALUES ($1,$2,'OPS',$3,$4,$5,$6::jsonb)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        cancellation.order_id,
        refundStatus === 'FAILED'
          ? 'order_cancellation_refund_failed'
          : 'order_cancellation_refund_succeeded',
        session.staffMemberId,
        cancellation.reason_code,
        receiptKey,
        JSON.stringify({
          cancellationId: cancellation.id,
          destination: cancellation.refund_destination,
          amountCents: cancellation.refund_amount_cents,
          refundId: refund?.id ?? null,
          refundStatus,
          failureReason,
          note: cancellation.staff_note,
          source: 'ADMIN',
        }),
      ],
    );
  }

  private async cancelProviderGroups(
    client: SqlClient,
    session: AdminStaffSession,
    orderNumber: string,
    cancellation: CancellationRow,
    fulfillment: FulfillmentService,
  ): Promise<void> {
    const groups = await client.query<CancellationGroupRow>(
      `SELECT * FROM app.order_cancellation_groups
      WHERE order_cancellation_id=$1 AND status NOT IN ('CANCELLED','NOT_REQUIRED') ORDER BY fulfillment_group_id`,
      [cancellation.id],
    );
    for (const group of groups.rows) {
      const idempotencyKey = `cancel:${cancellation.id}:${group.fulfillment_group_id}`;
      const eligible = await transactionOn(client, async () => {
        const order = await this.lockOrder(client, orderNumber);
        const eligibility = await this.loadEligibility(client, session, order);
        if (!eligibility.actions.cancel) {
          await client.query(
            `UPDATE app.order_cancellation_groups SET status='FAILED',provider_error_code='ORDER_NO_LONGER_ELIGIBLE',
            updated_at=now(),response_metadata=$2::jsonb WHERE id=$1`,
            [group.id, JSON.stringify({ idempotencyKey })],
          );
          return false;
        }
        await client.query(
          `UPDATE app.order_cancellation_groups SET status='REQUESTED',attempt_count=attempt_count+1,
          last_attempt_at=now(),updated_at=now(),response_metadata=$2::jsonb WHERE id=$1`,
          [group.id, JSON.stringify({ idempotencyKey })],
        );
        return true;
      });
      if (!eligible) continue;
      let state: CancellationGroupRow['status'];
      let errorCode: string | null = null;
      let occurredAt: Date | null = null;
      try {
        const response = await fulfillment.cancelOrder({
          externalOrderId: group.external_order_id!,
          idempotencyKey,
        });
        state = response.state;
        occurredAt = response.occurredAt;
      } catch (error) {
        state = 'FAILED';
        errorCode = normalizeFulfillmentError(error).code;
      }
      await transactionOn(client, async () => {
        await this.lockOrder(client, orderNumber);
        await client.query('SELECT id FROM app.order_fulfillment_groups WHERE id=$1 FOR UPDATE', [
          group.fulfillment_group_id,
        ]);
        await client.query(
          `UPDATE app.order_cancellation_groups SET status=$2,provider_error_code=$3,
          response_metadata=$4::jsonb,updated_at=now() WHERE id=$1`,
          [group.id, state, errorCode, JSON.stringify({ idempotencyKey, occurredAt })],
        );
        await client.query(
          `INSERT INTO app.order_operational_audits
          (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata)
          VALUES ($1,'order_cancellation_group_result','OPS',$2,$3,$4::jsonb)`,
          [
            cancellation.order_id,
            session.staffMemberId,
            cancellation.reason_code,
            JSON.stringify({
              cancellationId: cancellation.id,
              fulfillmentGroupId: group.fulfillment_group_id,
              status: state,
              providerErrorCode: errorCode,
              idempotencyKey,
              note: cancellation.staff_note,
              source: 'ADMIN',
            }),
          ],
        );
      });
    }
  }

  private async cancellationResult(
    client: SqlClient,
    cancellationId: string,
    duplicate: boolean,
  ): Promise<CancelOrderResult> {
    const row = (
      await client.query<CancellationRow & { order_status: string }>(
        `SELECT c.*,o.status AS order_status
      FROM app.order_cancellations c JOIN app.orders o ON o.id=c.order_id WHERE c.id=$1`,
        [cancellationId],
      )
    ).rows[0]!;
    const unresolved = await client.query<{ fulfillment_group_id: string }>(
      `SELECT attempt.fulfillment_group_id
      FROM app.order_cancellation_groups attempt JOIN app.order_fulfillment_groups group_row ON group_row.id=attempt.fulfillment_group_id
      WHERE attempt.order_cancellation_id=$1 AND (attempt.status NOT IN ('CANCELLED','NOT_REQUIRED')
        OR group_row.printing_status IN ('SUBMITTING','IN_PRODUCTION','PRINTED')
        OR group_row.fulfillment_status NOT IN ('UNFULFILLED','CANCELLED'))
      ORDER BY attempt.fulfillment_group_id`,
      [cancellationId],
    );
    const refund = (
      await client.query<{ id: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }>(
        'SELECT id,status FROM app.order_refunds WHERE idempotency_key=$1',
        [`cancellation-refund:${cancellationId}`],
      )
    ).rows[0];
    const failed =
      (
        await client.query(
          `SELECT id FROM app.order_operational_audits WHERE idempotency_key=$1
      AND action='order_cancellation_refund_failed'`,
          [`cancellation-refund-result:${cancellationId}`],
        )
      ).rows.length > 0;
    const refundStatus =
      row.refund_destination === 'LATER'
        ? 'LATER'
        : (refund?.status ?? (failed ? 'FAILED' : 'PENDING'));
    return {
      cancellationId,
      status: row.status,
      orderStatus: row.order_status,
      unresolvedFulfillmentGroupIds: unresolved.rows.map((group) => group.fulfillment_group_id),
      duplicate,
      refund: {
        destination: row.refund_destination,
        amountCents: row.refund_amount_cents,
        status: refundStatus,
        refundId: refund?.id ?? null,
        retryable: refundStatus === 'FAILED',
      },
    };
  }

  private async setArchive(
    session: AdminStaffSession,
    input: ArchiveOrderInput,
    archived: boolean,
  ): Promise<ArchiveResult> {
    this.validate(session, input);
    const action = archived ? 'order_archived' : 'order_unarchived';
    return withTransaction(this.pool, async (client) => {
      const order = await this.lockOrder(client, input.orderNumber);
      const existing = await this.existingAction<StoredArchiveResult>(
        client,
        order.id,
        action,
        input.idempotencyKey,
      );
      if (existing) {
        // Replay the committed result, even if a later action changed the current marker.
        return {
          ...existing,
          archivedAt: existing.archivedAt === null ? null : new Date(existing.archivedAt),
          duplicate: true,
        };
      }
      const eligibility = await this.loadEligibility(client, session, order);
      if (!eligibility.actions[archived ? 'archive' : 'unarchive']) {
        throw new OrderAdminActionConflictError(
          archived ? 'This order is not eligible for archive.' : 'This order is not archived.',
          eligibility,
        );
      }
      const updated = await client.query<LockedOrder>(
        `UPDATE app.orders SET archived_at=CASE WHEN $2::boolean THEN now() ELSE NULL END,
           archived_by_staff_member_id=CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END
         WHERE id=$1 RETURNING id,status,archived_at,archived_by_staff_member_id`,
        [order.id, archived, session.staffMemberId],
      );
      const after = updated.rows[0];
      if (!after) throw new OrderAdminActionNotFoundError('Order not found.');
      const result: StoredArchiveResult = {
        orderId: order.id,
        archived,
        archivedAt: after.archived_at?.toISOString() ?? null,
      };
      await this.audit(client, session, order.id, action, input, {
        before: archiveMetadata(order),
        after: archiveMetadata(after),
        result,
      });
      return { ...result, archivedAt: after.archived_at, duplicate: false };
    });
  }

  private validate(session: AdminStaffSession, input: ArchiveOrderInput): void {
    if (!session.staffMemberId || (session.role !== 'OWNER' && session.role !== 'OPERATIONS')) {
      throw new OrderAdminActionAccessError('Operations access is restricted.');
    }
    if (typeof input.orderNumber !== 'string' || !input.orderNumber.trim()) {
      throw new OrderAdminActionValidationError('An order number is required.');
    }
    if (typeof input.reasonCode !== 'string' || !input.reasonCode.trim()) {
      throw new OrderAdminActionValidationError('A reason code is required.');
    }
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) {
      throw new OrderAdminActionValidationError(
        'The internal note must be 1000 characters or fewer.',
      );
    }
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim().length < 12 ||
      input.idempotencyKey.length > 120
    ) {
      throw new OrderAdminActionValidationError(
        'Provide an idempotency key between 12 and 120 characters.',
      );
    }
  }

  private async lockOrder(client: SqlClient, orderNumber: string): Promise<LockedOrder> {
    const found = await client.query<LockedOrder>(
      `SELECT id,status,archived_at,archived_by_staff_member_id FROM app.orders
       WHERE order_number=$1 FOR UPDATE`,
      [orderNumber],
    );
    const order = found.rows[0];
    if (!order) throw new OrderAdminActionNotFoundError('Order not found.');
    return order;
  }

  private async existingAction<Result>(
    client: SqlClient,
    orderId: string,
    action: string,
    key: string,
  ): Promise<Result | null> {
    // The audit key is globally unique, including across different order locks.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order-admin-action:${key}`]);
    const existing = await client.query<{
      order_id: string;
      action: string;
      metadata: { result: Result };
    }>(
      `SELECT order_id,action,metadata FROM app.order_operational_audits WHERE idempotency_key=$1`,
      [key],
    );
    const audit = existing.rows[0];
    if (!audit) return null;
    if (audit.order_id !== orderId || audit.action !== action) {
      throw new OrderAdminActionConflictError(
        'Idempotency key belongs to another order or action.',
      );
    }
    return audit.metadata.result;
  }

  private async loadEligibility(
    client: SqlClient,
    session: AdminStaffSession,
    order: LockedOrder,
  ): Promise<OrderActionEligibility> {
    // Provider state updates can lock groups independently. Read their latest state under those locks.
    const groups = await client.query<{
      printing_status: PrintingGroupState;
      fulfillment_status: FulfillmentState;
    }>(
      `SELECT printing_status,fulfillment_status FROM app.order_fulfillment_groups
       WHERE order_id=$1 ORDER BY id FOR UPDATE`,
      [order.id],
    );
    const evidence = await client.query<{
      fulfillment_status: FulfillmentState;
      payment_status: PaymentStateEvidence['paymentStatus'];
      paid_cents: number;
      refunded_cents: number;
      reserved_refund_cents: number;
      returnable_quantity: number;
    }>(
      `SELECT layers.fulfillment_status, payment.status AS payment_status,
         CASE WHEN payment.status='SUCCEEDED' THEN payment.amount_cents ELSE 0 END AS paid_cents,
         COALESCE((SELECT sum(amount_cents) FROM app.order_refunds
           WHERE order_id=orders.id AND status='SUCCEEDED'),0)::int AS refunded_cents,
         COALESCE((SELECT sum(amount_cents) FROM app.order_refunds
           WHERE order_id=orders.id AND status IN ('PENDING','SUCCEEDED')),0)::int AS reserved_refund_cents,
         COALESCE((SELECT sum(GREATEST(0,item.quantity-COALESCE((
           SELECT sum(return_item.quantity) FROM app.order_return_items return_item
           JOIN app.order_returns returned ON returned.id=return_item.order_return_id
           WHERE return_item.order_item_id=item.id AND returned.state<>'REJECTED'
         ),0))) FROM app.order_items item
         JOIN app.order_fulfillment_group_items assignment ON assignment.order_item_id=item.id
         JOIN app.order_fulfillment_groups group_row ON group_row.id=assignment.fulfillment_group_id
         WHERE item.order_id=orders.id AND group_row.fulfillment_status IN ('FULFILLED','DELIVERED')),0)::int AS returnable_quantity
       FROM app.orders orders
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true
       WHERE orders.id=$1`,
      [order.id],
    );
    const row = evidence.rows[0];
    if (!row) throw new OrderAdminActionNotFoundError('Order not found.');
    // Only the canonical cancellation authority can make cancellation terminal for archive.
    const fulfillmentState =
      order.status === 'CANCELLED'
        ? 'CANCELLED'
        : row.fulfillment_status === 'CANCELLED'
          ? 'UNFULFILLED'
          : row.fulfillment_status;
    return resolveOrderActionEligibility({
      role: session.role,
      paymentState: projectPaymentState({
        paymentStatus: row.payment_status,
        paidCents: row.paid_cents,
        refundedCents: row.refunded_cents,
      }),
      printingStates: groups.rows.map((group) => group.printing_status),
      fulfillmentState,
      archived: order.archived_at !== null,
      refundableCents: Math.max(0, row.paid_cents - row.reserved_refund_cents),
      returnableQuantity: row.returnable_quantity,
      hasShippedQuantity: groups.rows.some((group) =>
        ['PARTIALLY_FULFILLED', 'FULFILLED', 'DELIVERED'].includes(group.fulfillment_status),
      ),
    });
  }

  private async audit(
    client: SqlClient,
    session: AdminStaffSession,
    orderId: string,
    action: string,
    input: ArchiveOrderInput,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.order_operational_audits (order_id,action,actor_type,actor_staff_member_id,
         reason_code,idempotency_key,metadata) VALUES ($1,$2,'OPS',$3,$4,$5,$6::jsonb)`,
      [
        orderId,
        action,
        session.staffMemberId,
        input.reasonCode,
        input.idempotencyKey,
        JSON.stringify({ ...metadata, source: 'ADMIN', note: input.note ?? null }),
      ],
    );
  }
}

async function transactionOn<T>(client: SqlClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function archiveMetadata(order: LockedOrder) {
  return {
    archivedAt: order.archived_at?.toISOString() ?? null,
    archivedByStaffMemberId: order.archived_by_staff_member_id,
  };
}
