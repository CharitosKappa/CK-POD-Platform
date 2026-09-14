import { randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { AdminStaffSession } from './admin-commerce';
import {
  OrderAdminActionAccessError,
  OrderAdminActionConflictError,
  OrderAdminActionNotFoundError,
  OrderAdminActionValidationError,
} from './order-admin-actions';
import { PaymentIntentRejectedError, PaymentIntentUncertainError } from './commerce-contracts';
import type {
  BillingAddress,
  PaymentAdapter,
  PaymentIntentRequest,
  PaymentOutcome,
  PaymentService,
  VerifiedPaymentEvent,
} from './commerce-contracts';

export type OrderEditPaymentStatus = 'PREPARING' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface PrepareOrderEditPaymentInput {
  orderNumber: string;
  orderRevisionId: string;
  idempotencyKey: string;
}

export interface OrderEditPaymentResult {
  paymentAttemptId: string;
  orderRevisionId: string;
  status: OrderEditPaymentStatus;
  amountCents: number;
  currency: 'USD';
  clientSecret: string | null;
  duplicate: boolean;
}

export interface OrderEditPaymentSettlementResult {
  handled: boolean;
  duplicate: boolean;
  orderNumber: string | null;
  status: OrderEditPaymentStatus | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  customer_email: string;
  billing_address_snapshot: Record<string, unknown>;
  shipping_address_snapshot: Record<string, unknown>;
  financial_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  amount_due_cents: number;
}

interface AttemptRow {
  id: string;
  order_id: string;
  order_revision_id: string;
  status: OrderEditPaymentStatus;
  amount_cents: number;
  currency: 'USD';
  provider: PaymentAdapter | null;
  provider_payment_id: string | null;
  provider_client_secret: string | null;
  idempotency_key: string;
  request_snapshot: PaymentIntentRequest;
  provider_submission_started_at: Date | null;
}

/**
 * Owns additional money collected after an upward staff edit. This aggregate never
 * rewrites the immutable checkout capture and never advances operational order state.
 */
export class OrderEditPaymentService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
  ) {}

  async prepare(
    session: AdminStaffSession,
    input: PrepareOrderEditPaymentInput,
  ): Promise<OrderEditPaymentResult> {
    validateActor(session);
    validateInput(input);
    const prepared = await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, input.orderNumber);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `order-edit-payment:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<AttemptRow>(
        `SELECT * FROM app.order_edit_payment_attempts
         WHERE idempotency_key=$1 FOR UPDATE`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (
          existing.rows[0].order_id !== order.id ||
          existing.rows[0].order_revision_id !== input.orderRevisionId
        )
          throw new OrderAdminActionConflictError(
            'This payment key belongs to another order revision.',
          );
        return { order, attempt: existing.rows[0], duplicate: true };
      }
      assertPayableRevision(order, input.orderRevisionId);
      const revision = await client.query(
        'SELECT 1 FROM app.order_revisions WHERE id=$1 AND order_id=$2',
        [input.orderRevisionId, order.id],
      );
      if (!revision.rows.length)
        throw new OrderAdminActionNotFoundError('Order revision not found.');
      const active = await client.query(
        `SELECT 1 FROM app.order_edit_payment_attempts
         WHERE order_id=$1 AND (status IN ('PREPARING','PENDING')
           OR (status='FAILED' AND provider_payment_id IS NOT NULL)) LIMIT 1`,
        [order.id],
      );
      if (active.rows.length)
        throw new OrderAdminActionConflictError(
          'An additional payment is already active for this order.',
        );
      const id = randomUUID();
      const requestSnapshot = paymentRequest(order, {
        id,
        order_id: order.id,
        order_revision_id: input.orderRevisionId,
        amount_cents: order.amount_due_cents,
        currency: 'USD',
        idempotency_key: input.idempotencyKey,
      });
      const attempt = (
        await client.query<AttemptRow>(
          `INSERT INTO app.order_edit_payment_attempts
           (id,order_id,order_revision_id,status,amount_cents,currency,initiated_by_staff_member_id,
            idempotency_key,request_snapshot)
           VALUES ($1,$2,$3,'PREPARING',$4,'USD',$5,$6,$7::jsonb) RETURNING *`,
          [
            id,
            order.id,
            input.orderRevisionId,
            order.amount_due_cents,
            session.staffMemberId,
            input.idempotencyKey,
            JSON.stringify(requestSnapshot),
          ],
        )
      ).rows[0]!;
      return { order, attempt, duplicate: false };
    });
    if (
      prepared.attempt.status === 'FAILED' &&
      prepared.attempt.provider_payment_id &&
      prepared.attempt.provider_submission_started_at
    )
      return this.recoverIntent(prepared.order, prepared.attempt);
    if (prepared.attempt.status !== 'PREPARING') return publicResult(prepared.attempt, true);
    if (prepared.attempt.provider_submission_started_at)
      return this.recoverIntent(prepared.order, prepared.attempt);
    return this.submitIntent(prepared.order, prepared.attempt, prepared.duplicate);
  }

  /** Reuses the original provider idempotency key after an ambiguous prepare response. */
  async reconcile(
    session: AdminStaffSession,
    input: PrepareOrderEditPaymentInput,
  ): Promise<OrderEditPaymentResult> {
    return this.prepare(session, input);
  }

  /** Settles only a cryptographically verified provider event supplied by the webhook boundary. */
  async settle(event: VerifiedPaymentEvent): Promise<OrderEditPaymentSettlementResult> {
    const reference = orderEditReference(event.metadata);
    if (!reference) return { handled: false, duplicate: false, orderNumber: null, status: null };
    return withTransaction(this.pool, async (client) => {
      const discovered = await client.query<{ order_id: string }>(
        'SELECT order_id FROM app.order_edit_payment_attempts WHERE id=$1',
        [reference.paymentAttemptId],
      );
      if (!discovered.rows[0])
        throw new OrderAdminActionNotFoundError('Additional payment attempt not found.');
      const order = await lockOrderById(client, discovered.rows[0].order_id);
      const attempt = (
        await client.query<AttemptRow>(
          'SELECT * FROM app.order_edit_payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',
          [reference.paymentAttemptId, order.id],
        )
      ).rows[0]!;
      assertExactEvent(event, reference, order, attempt);
      const inserted = await client.query(
        `INSERT INTO app.payment_events
         (provider,provider_event_id,event_name,verification_status,normalized_payload,processed_at)
         VALUES ($1,$2,$3,'VERIFIED',$4::jsonb,now())
         ON CONFLICT (provider,provider_event_id) DO NOTHING RETURNING id`,
        [
          event.provider,
          event.providerEventId,
          event.eventName,
          JSON.stringify({ ...event, metadata: reference }),
        ],
      );
      if (!inserted.rows.length || isTerminal(attempt.status))
        return {
          handled: true,
          duplicate: true,
          orderNumber: order.order_number,
          status: attempt.status,
        };

      const status = outcomeStatus(event.outcome);
      if (status === 'PENDING') {
        await updateAttempt(client, attempt.id, event, status, false);
        return {
          handled: true,
          duplicate: false,
          orderNumber: order.order_number,
          status,
        };
      }
      if (event.outcome === 'FAILED') {
        await updateAttempt(client, attempt.id, event, 'PENDING', false);
        await audit(client, order.id, attempt.id, 'order_additional_payment_attempt_failed', {
          orderRevisionId: attempt.order_revision_id,
          amountCents: attempt.amount_cents,
          currency: attempt.currency,
        });
        return {
          handled: true,
          duplicate: false,
          orderNumber: order.order_number,
          status: 'PENDING',
        };
      }
      if (status === 'CANCELLED') {
        await updateAttempt(client, attempt.id, event, status, true);
        await audit(
          client,
          order.id,
          attempt.id,
          `order_additional_payment_${status.toLowerCase()}`,
          {
            orderRevisionId: attempt.order_revision_id,
            amountCents: attempt.amount_cents,
            currency: attempt.currency,
          },
        );
        return {
          handled: true,
          duplicate: false,
          orderNumber: order.order_number,
          status,
        };
      }

      assertPayableRevision(order, attempt.order_revision_id, attempt.amount_cents);
      await updateAttempt(client, attempt.id, event, 'SUCCEEDED', true);
      await client.query(
        `INSERT INTO app.order_payment_captures
         (order_id,order_edit_payment_attempt_id,provider,provider_payment_id,amount_cents,
          currency,request_snapshot,captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
         ON CONFLICT (order_edit_payment_attempt_id) DO NOTHING`,
        [
          order.id,
          attempt.id,
          event.provider,
          event.paymentId,
          attempt.amount_cents,
          attempt.currency,
          JSON.stringify(attempt.request_snapshot),
        ],
      );
      const cleared = await client.query(
        `UPDATE app.orders SET amount_due_cents=0,updated_at=now()
         WHERE id=$1 AND status='ON_HOLD' AND amount_due_cents=$2
           AND financial_snapshot->>'editBalanceRevisionId'=$3 RETURNING id`,
        [order.id, attempt.amount_cents, attempt.order_revision_id],
      );
      if (!cleared.rows.length)
        throw new OrderAdminActionConflictError(
          'The verified payment no longer matches the current edited-order balance.',
        );
      await audit(client, order.id, attempt.id, 'order_additional_payment_succeeded', {
        orderRevisionId: attempt.order_revision_id,
        amountCents: attempt.amount_cents,
        currency: attempt.currency,
      });
      return {
        handled: true,
        duplicate: false,
        orderNumber: order.order_number,
        status: 'SUCCEEDED',
      };
    });
  }

  private async submitIntent(
    order: OrderRow,
    attempt: AttemptRow,
    duplicate: boolean,
  ): Promise<OrderEditPaymentResult> {
    const claimed = await withTransaction(this.pool, async (client) => {
      await lockOrderById(client, order.id);
      return (
        await client.query<AttemptRow>(
          `UPDATE app.order_edit_payment_attempts SET provider_submission_started_at=now(),updated_at=now()
           WHERE id=$1 AND status='PREPARING' AND provider_submission_started_at IS NULL RETURNING *`,
          [attempt.id],
        )
      ).rows[0];
    });
    if (!claimed) return this.recoverIntent(order, attempt);
    let intent;
    try {
      intent = await this.payments.createIntent(claimed.request_snapshot);
    } catch (error) {
      if (error instanceof PaymentIntentRejectedError) {
        await withTransaction(this.pool, async (client) => {
          await lockOrderById(client, order.id);
          await client.query(
            `UPDATE app.order_edit_payment_attempts
             SET status='FAILED',provider_status='REFUSED',completed_at=now(),updated_at=now()
             WHERE id=$1 AND status='PREPARING'`,
            [attempt.id],
          );
        });
        throw error;
      }
      throw error instanceof PaymentIntentUncertainError
        ? error
        : new PaymentIntentUncertainError();
    }
    let persisted: AttemptRow;
    try {
      persisted = await withTransaction(this.pool, async (client) => {
        const currentOrder = await lockOrderById(client, order.id);
        const current = (
          await client.query<AttemptRow>(
            'SELECT * FROM app.order_edit_payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',
            [attempt.id, order.id],
          )
        ).rows[0];
        if (!current)
          throw new OrderAdminActionNotFoundError('Additional payment attempt not found.');
        if (current.status !== 'PREPARING') return current;
        assertPayableRevision(currentOrder, current.order_revision_id, current.amount_cents);
        return (
          await client.query<AttemptRow>(
            `UPDATE app.order_edit_payment_attempts
           SET status='PENDING',provider=$2,provider_payment_id=$3,provider_client_secret=$4,
               provider_status=$5,updated_at=now()
           WHERE id=$1 AND status='PREPARING' RETURNING *`,
            [
              current.id,
              intent.provider,
              intent.providerPaymentId,
              intent.clientSecret,
              intent.status,
            ],
          )
        ).rows[0]!;
      });
    } catch {
      throw new PaymentIntentUncertainError();
    }
    return publicResult(persisted, duplicate);
  }

  private async recoverIntent(
    order: OrderRow,
    attempt: AttemptRow,
  ): Promise<OrderEditPaymentResult> {
    const request = attempt.request_snapshot;
    let intent = attempt.provider_payment_id
      ? await this.payments.getIntent?.({
          providerPaymentId: attempt.provider_payment_id,
          request,
        })
      : await this.payments.findIntent?.(request);
    if (!intent) throw new PaymentIntentUncertainError();
    if (attempt.provider && attempt.provider !== intent.provider)
      throw new PaymentIntentUncertainError();
    const persisted = await withTransaction(this.pool, async (client) => {
      const currentOrder = await lockOrderById(client, order.id);
      const current = (
        await client.query<AttemptRow>(
          'SELECT * FROM app.order_edit_payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',
          [attempt.id, order.id],
        )
      ).rows[0];
      if (!current)
        throw new OrderAdminActionNotFoundError('Additional payment attempt not found.');
      if (isTerminal(current.status)) return current;
      const status = intent.status === 'CANCELLED' ? 'CANCELLED' : 'PENDING';
      if (status !== 'CANCELLED')
        assertPayableRevision(currentOrder, current.order_revision_id, current.amount_cents);
      return (
        await client.query<AttemptRow>(
          `UPDATE app.order_edit_payment_attempts SET status=$2,provider=$3,provider_payment_id=$4,
           provider_client_secret=$5,provider_status=$6,
           completed_at=CASE WHEN $2='CANCELLED' THEN now() ELSE NULL END,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [
            current.id,
            status,
            intent.provider,
            intent.providerPaymentId,
            intent.clientSecret,
            intent.status,
          ],
        )
      ).rows[0]!;
    });
    return publicResult(persisted, true);
  }
}

function validateActor(session: AdminStaffSession): void {
  if (
    !session.staffMemberId ||
    !session.email ||
    (session.role !== 'OWNER' && session.role !== 'OPERATIONS')
  )
    throw new OrderAdminActionAccessError('You do not have access to order actions.');
}

function validateInput(input: PrepareOrderEditPaymentInput): void {
  if (
    !/^#[1-9][0-9]*$/.test(input.orderNumber) ||
    !isUuid(input.orderRevisionId) ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.trim().length < 12 ||
    input.idempotencyKey.length > 120
  )
    throw new OrderAdminActionValidationError('Enter a valid additional payment request.');
}

async function lockOrder(client: SqlClient, orderNumber: string): Promise<OrderRow> {
  const result = await client.query<OrderRow>(
    `SELECT id,order_number,status,customer_email,billing_address_snapshot,
            shipping_address_snapshot,financial_snapshot,pricing_snapshot,amount_due_cents
     FROM app.orders WHERE order_number=$1 FOR UPDATE`,
    [orderNumber],
  );
  if (!result.rows[0]) throw new OrderAdminActionNotFoundError('Order not found.');
  return result.rows[0];
}

async function lockOrderById(client: SqlClient, id: string): Promise<OrderRow> {
  const result = await client.query<OrderRow>(
    `SELECT id,order_number,status,customer_email,billing_address_snapshot,
            shipping_address_snapshot,financial_snapshot,pricing_snapshot,amount_due_cents
     FROM app.orders WHERE id=$1 FOR UPDATE`,
    [id],
  );
  if (!result.rows[0]) throw new OrderAdminActionNotFoundError('Order not found.');
  return result.rows[0];
}

function assertPayableRevision(order: OrderRow, revisionId: string, amount?: number): void {
  const currency = order.pricing_snapshot.currency;
  if (
    order.status !== 'ON_HOLD' ||
    order.amount_due_cents <= 0 ||
    (amount !== undefined && order.amount_due_cents !== amount) ||
    currency !== 'USD' ||
    order.financial_snapshot.editBalanceRevisionId !== revisionId
  )
    throw new OrderAdminActionConflictError(
      'The order does not have a matching edited-order balance ready for payment.',
    );
}

function orderEditReference(metadata: Record<string, unknown>): {
  paymentAttemptId: string;
  orderId: string;
  orderRevisionId: string;
} | null {
  if (metadata.payment_reference_kind !== 'ORDER_EDIT') return null;
  const paymentAttemptId = metadata.order_edit_payment_attempt_id;
  const orderId = metadata.order_id;
  const orderRevisionId = metadata.order_revision_id;
  if (!isUuid(paymentAttemptId) || !isUuid(orderId) || !isUuid(orderRevisionId))
    throw new OrderAdminActionValidationError(
      'The payment event has an invalid order-edit reference.',
    );
  return { paymentAttemptId, orderId, orderRevisionId };
}

function assertExactEvent(
  event: VerifiedPaymentEvent,
  reference: NonNullable<ReturnType<typeof orderEditReference>>,
  order: OrderRow,
  attempt: AttemptRow,
): void {
  if (
    reference.orderId !== order.id ||
    reference.orderRevisionId !== attempt.order_revision_id ||
    attempt.order_id !== order.id ||
    (attempt.provider !== null && attempt.provider !== event.provider) ||
    (attempt.provider_payment_id !== null && attempt.provider_payment_id !== event.paymentId) ||
    event.amountCents !== attempt.amount_cents ||
    event.currency !== attempt.currency
  )
    throw new OrderAdminActionConflictError(
      'The verified payment does not match the current edited-order balance.',
    );
}

async function updateAttempt(
  client: SqlClient,
  id: string,
  event: VerifiedPaymentEvent,
  status: OrderEditPaymentStatus,
  terminal: boolean,
): Promise<void> {
  await client.query(
    `UPDATE app.order_edit_payment_attempts
     SET status=$2,provider=$3,provider_payment_id=$4,provider_status=$5,
         completed_at=CASE WHEN $6 THEN now() ELSE NULL END,updated_at=now()
     WHERE id=$1`,
    [id, status, event.provider, event.paymentId, event.outcome, terminal],
  );
}

async function audit(
  client: SqlClient,
  orderId: string,
  attemptId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO app.order_operational_audits
     (order_id,action,actor_type,reason_code,metadata)
     VALUES ($1,$2,'SYSTEM','ORDER_EDIT_PAYMENT',$3::jsonb)`,
    [orderId, action, JSON.stringify({ ...metadata, paymentAttemptId: attemptId })],
  );
}

function publicResult(row: AttemptRow, duplicate: boolean): OrderEditPaymentResult {
  return {
    paymentAttemptId: row.id,
    orderRevisionId: row.order_revision_id,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    clientSecret: row.provider_client_secret,
    duplicate,
  };
}

function outcomeStatus(outcome: PaymentOutcome): OrderEditPaymentStatus {
  return outcome === 'SUCCEEDED'
    ? 'SUCCEEDED'
    : outcome === 'FAILED'
      ? 'FAILED'
      : outcome === 'CANCELLED'
        ? 'CANCELLED'
        : 'PENDING';
}

function isTerminal(status: OrderEditPaymentStatus): boolean {
  return status === 'SUCCEEDED' || status === 'CANCELLED';
}

function paymentRequest(
  order: OrderRow,
  attempt: Pick<
    AttemptRow,
    'id' | 'order_id' | 'order_revision_id' | 'amount_cents' | 'currency' | 'idempotency_key'
  >,
): PaymentIntentRequest {
  return {
    reference: {
      kind: 'ORDER_EDIT',
      orderId: attempt.order_id,
      orderRevisionId: attempt.order_revision_id,
      orderEditPaymentAttemptId: attempt.id,
    },
    amountCents: attempt.amount_cents,
    currency: attempt.currency,
    idempotencyKey: attempt.idempotency_key,
    customerEmail: order.customer_email,
    billingAddress: billingAddress(order.billing_address_snapshot, order.shipping_address_snapshot),
  };
}

function billingAddress(
  billing: Record<string, unknown>,
  shipping: Record<string, unknown>,
): BillingAddress {
  const source = Object.keys(billing).length ? billing : shipping;
  const value = (camel: string, snake: string) => source[camel] ?? source[snake];
  const required = (camel: string, snake: string) => {
    const result = value(camel, snake);
    if (typeof result !== 'string' || !result.trim())
      throw new OrderAdminActionConflictError('The order billing address is unavailable.');
    return result;
  };
  const line2 = value('line2', 'line2');
  return {
    recipientName: required('recipientName', 'recipient_name'),
    line1: required('line1', 'line1'),
    line2: typeof line2 === 'string' && line2.trim() ? line2 : null,
    city: required('city', 'city'),
    stateCode: required('stateCode', 'state_code'),
    postalCode: required('postalCode', 'postal_code'),
    countryCode: required('countryCode', 'country_code'),
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
