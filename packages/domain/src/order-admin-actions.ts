import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  AdminCommerceValidationError,
  adminOrderLayerSql,
  type AdminStaffSession,
} from './admin-commerce';
import {
  resolveOrderActionEligibility,
  type OrderActionEligibility,
} from './order-admin-actions-contracts';
import {
  projectPaymentState,
  type FulfillmentState,
  type PaymentStateEvidence,
  type PrintingGroupState,
} from './order-detail-contracts';
import { OrderOperationsAccessError } from './order-operations';

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
  constructor(private readonly pool: SqlPool) {}

  async archive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, true);
  }

  async unarchive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, false);
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

function archiveMetadata(order: LockedOrder) {
  return {
    archivedAt: order.archived_at?.toISOString() ?? null,
    archivedByStaffMemberId: order.archived_by_staff_member_id,
  };
}
