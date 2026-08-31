import { type SqlPool, withTransaction } from '@let-it-be/db';
import type { PaymentService } from './commerce-contracts';
import type { ActiveSession } from './identity';

export type LifecycleClassification = 'TRANSACTIONAL' | 'MARKETING';
export type LifecycleMessageType =
  | 'WELCOME'
  | 'SAVED_PROJECT'
  | 'GENERATED_NO_PURCHASE'
  | 'CART_ABANDONMENT'
  | 'CHECKOUT_ABANDONMENT'
  | 'ORDER_CONFIRMATION'
  | 'SHIPPING_CONFIRMATION'
  | 'DELIVERY_CONFIRMATION'
  | 'REVIEW_REQUEST'
  | 'REORDER_REVISIT';

const refundReasonCodes = [
  'CUSTOMER_REQUEST',
  'DUPLICATE_CHARGE',
  'PRODUCTION_DEFECT',
  'CANCELLED',
] as const;
const reprintReasonCodes = [
  'PRODUCTION_DEFECT',
  'DAMAGED_IN_TRANSIT',
  'LOST_IN_TRANSIT',
  'WRONG_ITEM',
] as const;
const providerDefectCodes = [
  'PRINT_QUALITY',
  'COLOR_ACCURACY',
  'MISPRINT',
  'DAMAGED',
  'LATE_SHIPMENT',
  'WRONG_ITEM',
] as const;

function requireReason(value: string, allowed: readonly string[], subject: string) {
  if (!allowed.includes(value)) throw new Error(`Unsupported ${subject} reason.`);
}

export interface LifecycleMessagingService {
  send(input: {
    type: LifecycleMessageType;
    classification: LifecycleClassification;
    recipientEmail: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<{ providerMessageId: string }>;
}

/** Local/CI adapter: never sends email and deliberately exposes no customer artwork or policy evidence. */
export class FakeLifecycleMessagingService implements LifecycleMessagingService {
  async send(input: Parameters<LifecycleMessagingService['send']>[0]) {
    return {
      providerMessageId: `fake_email_${input.idempotencyKey.replace(/[^a-z0-9]/gi, '').slice(-24)}`,
    };
  }
}

/** Optional production adapter. It sends only the minimised payload supplied by the orchestrator. */
export class KlaviyoLifecycleMessagingService implements LifecycleMessagingService {
  public constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://a.klaviyo.com/api',
  ) {}
  async send(input: Parameters<LifecycleMessagingService['send']>[0]) {
    const response = await fetch(`${this.baseUrl}/events/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        'content-type': 'application/json',
        revision: '2024-10-15',
      },
      body: JSON.stringify({
        data: {
          type: 'event',
          attributes: {
            metric: { data: { type: 'metric', attributes: { name: `let-it-be.${input.type}` } } },
            profile: { data: { type: 'profile', attributes: { email: input.recipientEmail } } },
            properties: input.payload,
          },
        },
      }),
    });
    if (!response.ok) throw new Error('Lifecycle provider could not accept the event.');
    return { providerMessageId: response.headers.get('request-id') ?? input.idempotencyKey };
  }
}

/** Platform-owned event writer. Idempotency makes retries and webhook replays non-counting. */
export class AnalyticsEventService {
  public constructor(private readonly pool: SqlPool) {}

  async emit(input: {
    name: string;
    idempotencyKey: string;
    sessionId?: string;
    userId?: string;
    projectId?: string;
    generationId?: string;
    orderId?: string;
    dimensions: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO app.analytics_events (event_name, project_id, generation_id, dimensions, idempotency_key)
       VALUES ($1, $2::uuid, $3::uuid, $4::jsonb, $5) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        input.name,
        input.projectId ?? null,
        input.generationId ?? null,
        JSON.stringify({
          ...input.dimensions,
          sessionId: input.sessionId ?? null,
          userId: input.userId ?? null,
          orderId: input.orderId ?? null,
        }),
        input.idempotencyKey,
      ],
    );
  }

  async dashboard(
    from: Date,
    to: Date,
  ): Promise<Record<string, number | null | 'UNAVAILABLE' | 'INCOMPLETE'>> {
    const result = await this.pool.query<{
      orders: string;
      revenue: string;
      aov: string | null;
      generations: string;
      successful: string;
      add_to_cart: string;
      refunds: string;
      reprints: string;
      defects: string;
      external_orders: string;
      production_rejections: string;
    }>(
      `SELECT
        (SELECT count(*) FROM app.orders WHERE created_at >= $1 AND created_at < $2)::text AS orders,
        (SELECT coalesce(sum((financial_snapshot->>'revenueCents')::int), 0) FROM app.orders WHERE created_at >= $1 AND created_at < $2)::text AS revenue,
        (SELECT avg((financial_snapshot->>'revenueCents')::numeric) FROM app.orders WHERE created_at >= $1 AND created_at < $2)::text AS aov,
        (SELECT count(*) FROM app.generations WHERE created_at >= $1 AND created_at < $2)::text AS generations,
        (SELECT count(*) FROM app.generations WHERE status = 'SUCCEEDED' AND created_at >= $1 AND created_at < $2)::text AS successful,
        (SELECT count(*) FROM app.analytics_events WHERE event_name = 'add_to_cart' AND occurred_at >= $1 AND occurred_at < $2)::text AS add_to_cart,
        (SELECT coalesce(sum(amount_cents),0) FROM app.order_refunds WHERE status = 'SUCCEEDED' AND created_at >= $1 AND created_at < $2)::text AS refunds,
        (SELECT count(*) FROM app.order_reprints WHERE created_at >= $1 AND created_at < $2)::text AS reprints,
        (SELECT count(*) FROM app.provider_defects WHERE created_at >= $1 AND created_at < $2)::text AS defects,
        (SELECT count(*) FROM app.external_fulfillment_orders WHERE created_at >= $1 AND created_at < $2)::text AS external_orders,
        (SELECT count(*) FROM app.order_reviews WHERE outcome = 'REJECTED' AND created_at >= $1 AND created_at < $2)::text AS production_rejections`,
      [from, to],
    );
    const row = result.rows[0];
    const orders = Number(row?.orders ?? 0);
    const generations = Number(row?.generations ?? 0);
    const successful = Number(row?.successful ?? 0);
    const carts = Number(row?.add_to_cart ?? 0);
    const refunds = Number(row?.refunds ?? 0);
    const reprints = Number(row?.reprints ?? 0);
    const defects = Number(row?.defects ?? 0);
    const externalOrders = Number(row?.external_orders ?? 0);
    const revenueCents = Number(row?.revenue ?? 0);
    return {
      orders,
      revenueCents,
      aovCents: row?.aov ? Number(row.aov) : null,
      taxRevenueCents: 0,
      generations,
      generationSucceeded: successful,
      generationSuccessRate: generations ? successful / generations : null,
      generationToPurchase: successful ? orders / successful : null,
      addToCart: carts,
      addToCartToPurchase: carts ? orders / carts : null,
      averageGenerationsPerOrder: orders ? generations / orders : null,
      refundCents: refunds,
      refundRate: revenueCents ? refunds / revenueCents : null,
      reprints,
      reprintRate: orders ? reprints / orders : null,
      providerDefects: defects,
      providerDefectRate: externalOrders ? defects / externalOrders : null,
      productionRejections: Number(row?.production_rejections ?? 0),
      productionRejectionRate: orders ? Number(row?.production_rejections ?? 0) / orders : null,
      grossMarginCents: 'INCOMPLETE',
      cacCents: 'UNAVAILABLE',
      ltvCents: 'UNAVAILABLE',
      contributionMarginCents: 'INCOMPLETE',
    };
  }

  async funnel(from: Date, to: Date) {
    const events = await this.pool.query<{ event_name: string; count: string }>(
      `SELECT event_name, count(*)::text AS count FROM app.analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY event_name`,
      [from, to],
    );
    const counts = Object.fromEntries(
      events.rows.map((row) => [row.event_name, Number(row.count)]),
    );
    const orders = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.orders WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    return {
      visitor: counts.session_started ?? null,
      productSelected: counts.product_selected ?? 0,
      generationStarted: counts.generation_started ?? 0,
      generationSucceeded: counts.generation_succeeded ?? 0,
      editorOpened: counts.editor_opened ?? 0,
      proofApproved: counts.proof_approved ?? 0,
      addToCart: counts.add_to_cart ?? 0,
      checkoutStarted: counts.checkout_started ?? 0,
      payment: Number(orders.rows[0]?.count ?? 0),
    };
  }

  async styleAttribution(from: Date, to: Date) {
    const result = await this.pool.query<{
      style_family_id: string | null;
      preset_id: string | null;
      preset_version: string | null;
      events: string;
    }>(
      `SELECT dimensions->>'styleFamilyId' AS style_family_id, dimensions->>'presetId' AS preset_id,
              dimensions->>'presetVersion' AS preset_version, count(*)::text AS events
       FROM app.analytics_events WHERE occurred_at >= $1 AND occurred_at < $2
       GROUP BY 1, 2, 3 ORDER BY count(*) DESC`,
      [from, to],
    );
    return result.rows.map((row) => ({
      styleFamilyId: row.style_family_id,
      presetId: row.preset_id,
      presetVersion: row.preset_version,
      events: Number(row.events),
    }));
  }
}

export class LifecycleOrchestrator {
  public constructor(
    private readonly pool: SqlPool,
    private readonly messaging: LifecycleMessagingService = new FakeLifecycleMessagingService(),
    private readonly provider: 'FAKE' | 'KLAVIYO' = 'FAKE',
    private readonly marketingEnabled = true,
  ) {}

  async trigger(input: {
    type: LifecycleMessageType;
    classification: LifecycleClassification;
    recipientEmail: string;
    idempotencyKey: string;
    orderId?: string;
    projectId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // Transactional delivery is never coupled to the marketing kill switch.
    if (input.classification === 'MARKETING' && !this.marketingEnabled) return;
    const pending = await this.pool.query<{ id: string }>(
      `INSERT INTO app.lifecycle_deliveries (message_type, channel, classification, recipient_email, order_id, project_id, idempotency_key, provider, status, payload)
       VALUES ($1, 'EMAIL', $2, $3, $4::uuid, $5::uuid, $6, $7, 'PENDING', $8::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        input.type,
        input.classification,
        input.recipientEmail,
        input.orderId ?? null,
        input.projectId ?? null,
        input.idempotencyKey,
        this.provider,
        JSON.stringify(input.payload),
      ],
    );
    const row = pending.rows[0];
    if (!row) return;
    try {
      const sent = await this.messaging.send(input);
      await this.pool.query(
        `UPDATE app.lifecycle_deliveries SET status = 'SENT', provider_message_id = $2, sent_at = now(), updated_at = now() WHERE id = $1`,
        [row.id, sent.providerMessageId],
      );
    } catch {
      await this.pool.query(
        `UPDATE app.lifecycle_deliveries SET status = 'FAILED', updated_at = now() WHERE id = $1`,
        [row.id],
      );
    }
  }

  async suppressAbandonment(input: {
    recipientEmail: string;
    projectId?: string;
    orderId?: string;
  }) {
    await this.pool.query(
      `UPDATE app.lifecycle_deliveries SET status = 'SUPPRESSED', updated_at = now()
       WHERE recipient_email = $1 AND status IN ('PENDING', 'RETRYING') AND classification = 'MARKETING'
         AND message_type IN ('GENERATED_NO_PURCHASE', 'CART_ABANDONMENT', 'CHECKOUT_ABANDONMENT')
         AND ($2::uuid IS NULL OR project_id = $2::uuid)`,
      [input.recipientEmail, input.projectId ?? null],
    );
  }

  async processAbandonment(input: {
    generatedNoPurchaseDelayMs: number;
    cartDelayMs: number;
    checkoutDelayMs: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const checkoutBefore = new Date(now.getTime() - input.checkoutDelayMs);
    const cartBefore = new Date(now.getTime() - input.cartDelayMs);
    const generatedBefore = new Date(now.getTime() - input.generatedNoPurchaseDelayMs);
    const checkouts = await this.pool.query<{
      email: string;
      checkout_id: string;
      project_id: string;
    }>(
      `SELECT a.email, c.id AS checkout_id, i.project_id FROM app.checkout_attempts c JOIN app.shipping_addresses a ON a.id = c.shipping_address_id JOIN app.cart_items i ON i.cart_id = c.cart_id WHERE c.status IN ('PENDING','FAILED') AND c.created_at < $1 AND NOT EXISTS (SELECT 1 FROM app.orders o WHERE o.checkout_attempt_id = c.id)`,
      [checkoutBefore],
    );
    for (const row of checkouts.rows)
      await this.trigger({
        type: 'CHECKOUT_ABANDONMENT',
        classification: 'MARKETING',
        recipientEmail: row.email,
        projectId: row.project_id,
        idempotencyKey: `checkout-abandonment:${row.checkout_id}`,
        payload: { projectId: row.project_id },
      });
    const carts = await this.pool.query<{ email: string; cart_id: string; project_id: string }>(
      `SELECT u.email, c.id AS cart_id, i.project_id FROM app.carts c JOIN app.users u ON u.id = c.owner_user_id JOIN app.cart_items i ON i.cart_id = c.id WHERE c.status = 'ACTIVE' AND c.updated_at < $1 AND NOT EXISTS (SELECT 1 FROM app.checkout_attempts ca JOIN app.orders o ON o.checkout_attempt_id = ca.id WHERE ca.cart_id = c.id)`,
      [cartBefore],
    );
    for (const row of carts.rows)
      await this.trigger({
        type: 'CART_ABANDONMENT',
        classification: 'MARKETING',
        recipientEmail: row.email,
        projectId: row.project_id,
        idempotencyKey: `cart-abandonment:${row.cart_id}`,
        payload: { projectId: row.project_id },
      });
    const generated = await this.pool.query<{ email: string; project_id: string }>(
      `SELECT DISTINCT u.email, g.project_id FROM app.generations g JOIN app.projects p ON p.id = g.project_id JOIN app.users u ON u.id = p.owner_user_id WHERE g.status = 'SUCCEEDED' AND g.created_at < $1 AND NOT EXISTS (SELECT 1 FROM app.orders o JOIN app.order_items i ON i.order_id = o.id WHERE i.project_id = g.project_id)`,
      [generatedBefore],
    );
    for (const row of generated.rows)
      await this.trigger({
        type: 'GENERATED_NO_PURCHASE',
        classification: 'MARKETING',
        recipientEmail: row.email,
        projectId: row.project_id,
        idempotencyKey: `generated-no-purchase:${row.project_id}`,
        payload: { projectId: row.project_id },
      });
  }

  async processReorderRevisit(input: { delayMs: number; now?: Date }) {
    const before = new Date((input.now ?? new Date()).getTime() - input.delayMs);
    const orders = await this.pool.query<{
      id: string;
      customer_email: string;
      project_id: string;
    }>(
      `SELECT o.id, o.customer_email, i.project_id FROM app.orders o JOIN app.order_items i ON i.order_id = o.id WHERE o.status = 'DELIVERED' AND o.updated_at < $1`,
      [before],
    );
    for (const row of orders.rows)
      await this.trigger({
        type: 'REORDER_REVISIT',
        classification: 'MARKETING',
        recipientEmail: row.customer_email,
        orderId: row.id,
        projectId: row.project_id,
        idempotencyKey: `reorder-revisit:${row.id}`,
        payload: { projectId: row.project_id },
      });
  }
}

export class CxOperationsService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
    private readonly analytics = new AnalyticsEventService(pool),
  ) {}

  async search(session: ActiveSession, query: string) {
    await this.requireCx(session);
    const value = `%${query.trim()}%`;
    const result = await this.pool.query<{
      order_number: string;
      customer_email: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT order_number, customer_email, status, created_at FROM app.orders WHERE order_number ILIKE $1 OR customer_email ILIKE $1 ORDER BY created_at DESC LIMIT 50`,
      [value],
    );
    return result.rows;
  }

  async dashboard(session: ActiveSession, from: Date, to: Date) {
    await this.requireCx(session);
    return this.analytics.dashboard(from, to);
  }

  async analyticsReport(session: ActiveSession, from: Date, to: Date) {
    await this.requireCx(session);
    const [funnel, styleAttribution] = await Promise.all([
      this.analytics.funnel(from, to),
      this.analytics.styleAttribution(from, to),
    ]);
    return { funnel, styleAttribution };
  }

  async visibility(session: ActiveSession) {
    await this.requireCx(session);
    const [
      refunds,
      reprints,
      defects,
      credits,
      generationFailures,
      systemFailures,
      lifecycleFailures,
      notes,
      audits,
    ] = await Promise.all([
      this.pool.query(
        `SELECT id, amount_cents, reason_code, status, created_at FROM app.order_refunds ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, original_order_id, reason_code, status, estimated_cost_cents, created_at FROM app.order_reprints ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, order_id, provider_id, defect_code, created_at FROM app.provider_defects ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT l.id, a.current_balance, l.entry_type, l.amount, l.balance_after, l.created_at FROM app.credit_ledger l JOIN app.credit_accounts a ON a.id = l.credit_account_id ORDER BY l.created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT g.id, g.project_id, g.failure_category, g.credit_status, g.created_at FROM app.generations g WHERE g.status IN ('FAILED','REJECTED_INTERNAL') ORDER BY g.created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, operation, failure_category, created_at FROM app.fulfillment_operations WHERE status = 'FAILED'
           UNION ALL
           SELECT id, action AS operation, failure_code AS failure_category, created_at FROM app.order_fulfillment_actions WHERE status = 'FAILED'
           ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, message_type, classification, status, created_at FROM app.lifecycle_deliveries WHERE status IN ('FAILED','RETRYING') ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, order_id, customer_email, body, created_at FROM app.customer_notes ORDER BY created_at DESC LIMIT 50`,
      ),
      this.pool.query(
        `SELECT id, order_id, action, reason_code, created_at FROM app.order_operational_audits ORDER BY created_at DESC LIMIT 50`,
      ),
    ]);
    return {
      refunds: refunds.rows,
      reprints: reprints.rows,
      defects: defects.rows,
      credits: credits.rows,
      generationFailures: generationFailures.rows,
      systemFailures: systemFailures.rows,
      lifecycleFailures: lifecycleFailures.rows,
      notes: notes.rows,
      audits: audits.rows,
    };
  }

  async refund(
    session: ActiveSession,
    input: {
      orderNumber: string;
      amountCents: number;
      reasonCode: string;
      notes?: string;
      idempotencyKey: string;
    },
  ) {
    await this.requireCx(session);
    requireReason(input.reasonCode, refundReasonCodes, 'refund');
    if (!session.userId || input.amountCents <= 0)
      throw new Error('A positive refund amount is required.');
    const reservation = await withTransaction(this.pool, async (client) => {
      const order = await client.query<{
        id: string;
        payment_id: string;
        provider: 'FAKE' | 'STRIPE';
        provider_payment_id: string;
        amount_cents: number;
      }>(
        `SELECT o.id, p.id AS payment_id, p.provider, p.provider_payment_id, p.amount_cents FROM app.orders o JOIN app.payments p ON p.checkout_attempt_id = o.checkout_attempt_id WHERE o.order_number = $1`,
        [input.orderNumber],
      );
      const row = order.rows[0];
      if (!row) throw new Error('Order payment is unavailable.');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [row.id]);
      const existing = await client.query<{ provider_refund_id: string | null; status: string }>(
        `SELECT provider_refund_id, status FROM app.order_refunds WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return { row, existing: existing.rows[0] };
      const prior = await client.query<{ amount: string }>(
        `SELECT coalesce(sum(amount_cents),0)::text AS amount FROM app.order_refunds WHERE order_id = $1 AND status IN ('PENDING','SUCCEEDED')`,
        [row.id],
      );
      if (Number(prior.rows[0]?.amount ?? 0) + input.amountCents > row.amount_cents)
        throw new Error('Refund exceeds the captured payment.');
      await client.query(
        `INSERT INTO app.order_refunds (order_id, payment_id, provider, idempotency_key, amount_cents, reason_code, status, notes, initiated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8)`,
        [
          row.id,
          row.payment_id,
          row.provider,
          input.idempotencyKey,
          input.amountCents,
          input.reasonCode,
          input.notes ?? null,
          session.userId,
        ],
      );
      await this.audit(client, row.id, 'refund_requested', session, input.reasonCode, {
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
      });
      return { row, existing: null };
    });
    if (reservation.existing)
      return {
        providerRefundId: reservation.existing.provider_refund_id,
        duplicate: true,
        status: reservation.existing.status,
      };
    try {
      const provider = await this.payments.refund({
        providerPaymentId: reservation.row.provider_payment_id,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
      });
      await withTransaction(this.pool, async (client) => {
        await client.query(
          `UPDATE app.order_refunds SET provider_refund_id = $2, status = 'SUCCEEDED', completed_at = now() WHERE idempotency_key = $1 AND status = 'PENDING'`,
          [input.idempotencyKey, provider.providerRefundId],
        );
        await this.audit(
          client,
          reservation.row.id,
          'refund_succeeded',
          session,
          input.reasonCode,
          { amountCents: input.amountCents, providerRefundId: provider.providerRefundId },
        );
      });
      await this.analytics.emit({
        name: 'refund',
        idempotencyKey: `analytics:${input.idempotencyKey}`,
        orderId: reservation.row.id,
        dimensions: { amountCents: input.amountCents, reasonCode: input.reasonCode },
      });
      return {
        providerRefundId: provider.providerRefundId,
        duplicate: false,
        status: 'SUCCEEDED' as const,
      };
    } catch (error) {
      await this.pool.query(
        `UPDATE app.order_refunds SET status = 'FAILED' WHERE idempotency_key = $1 AND status = 'PENDING'`,
        [input.idempotencyKey],
      );
      throw error;
    }
  }

  async createReprint(
    session: ActiveSession,
    input: {
      orderNumber: string;
      orderItemId: string;
      reasonCode: string;
      estimatedCostCents?: number;
      notes?: string;
    },
  ) {
    await this.requireCx(session);
    requireReason(input.reasonCode, reprintReasonCodes, 'reprint');
    if (!session.userId) throw new Error('Operations access is restricted.');
    const source = await this.pool.query<{
      order_id: string;
      item_id: string;
      external_id: string | null;
    }>(
      `SELECT o.id AS order_id, i.id AS item_id, e.id AS external_id FROM app.orders o JOIN app.order_items i ON i.order_id = o.id LEFT JOIN app.external_fulfillment_orders e ON e.order_id = o.id WHERE o.order_number = $1 AND i.id = $2`,
      [input.orderNumber, input.orderItemId],
    );
    const row = source.rows[0];
    if (!row) throw new Error('Original order item is unavailable.');
    const created = await this.pool.query<{ id: string }>(
      `INSERT INTO app.order_reprints (original_order_id, original_order_item_id, original_external_order_id, reason_code, status, estimated_cost_cents, notes, created_by_user_id) VALUES ($1,$2,$3::uuid,$4,'PENDING_REVIEW',$5,$6,$7) RETURNING id`,
      [
        row.order_id,
        row.item_id,
        row.external_id,
        input.reasonCode,
        input.estimatedCostCents ?? null,
        input.notes ?? null,
        session.userId,
      ],
    );
    await this.analytics.emit({
      name: 'reprint',
      idempotencyKey: `reprint:${created.rows[0]!.id}`,
      orderId: row.order_id,
      dimensions: {
        reasonCode: input.reasonCode,
        estimatedCostCents: input.estimatedCostCents ?? null,
        status: 'PENDING_REVIEW',
      },
    });
    await this.audit(this.pool, row.order_id, 'reprint_requested', session, input.reasonCode, {
      reprintId: created.rows[0]!.id,
      orderItemId: row.item_id,
      originalExternalOrderId: row.external_id,
      estimatedCostCents: input.estimatedCostCents ?? null,
    });
    return { id: created.rows[0]!.id, status: 'PENDING_REVIEW' as const };
  }

  async addCustomerNote(
    session: ActiveSession,
    input: { customerEmail: string; body: string; orderNumber?: string },
  ) {
    await this.requireCx(session);
    if (!session.userId || !input.customerEmail.includes('@') || !input.body.trim())
      throw new Error('A customer email and note are required.');
    const order = input.orderNumber
      ? await this.pool.query<{ id: string }>(`SELECT id FROM app.orders WHERE order_number = $1`, [
          input.orderNumber,
        ])
      : null;
    if (input.orderNumber && !order?.rows[0]) throw new Error('Order is unavailable.');
    const created = await this.pool.query<{ id: string }>(
      `INSERT INTO app.customer_notes (order_id, customer_email, body, created_by_user_id)
       VALUES ($1::uuid,$2,$3,$4::uuid) RETURNING id`,
      [order?.rows[0]?.id ?? null, input.customerEmail, input.body.trim(), session.userId],
    );
    if (order?.rows[0])
      await this.audit(this.pool, order.rows[0].id, 'customer_note_added', session, null, {
        noteId: created.rows[0]!.id,
      });
    return { id: created.rows[0]!.id };
  }

  async approveReprint(
    session: ActiveSession,
    reprintId: string,
    approved: boolean,
    notes?: string,
  ) {
    await this.requireCx(session);
    if (!session.userId) throw new Error('Operations access is restricted.');
    const result = await this.pool.query<{
      order_id: string;
      qualification_id: string | null;
      qualification_status: string | null;
      active: boolean | null;
      provider_status: string | null;
      technical_compatible: boolean | null;
      g3_reviewed: boolean | null;
      physical_test_status: string | null;
      shipping_enabled: boolean | null;
    }>(
      `SELECT r.original_order_id AS order_id, q.id AS qualification_id, q.qualification_status, q.active, p.status AS provider_status, q.technical_compatible, q.g3_reviewed, q.physical_test_status, q.shipping_enabled
       FROM app.order_reprints r
       LEFT JOIN LATERAL (SELECT selected_qualification_id FROM app.order_final_routing f WHERE f.order_id = r.original_order_id ORDER BY f.created_at DESC LIMIT 1) f ON true
       LEFT JOIN app.provider_qualifications q ON q.id = f.selected_qualification_id
       LEFT JOIN app.print_providers p ON p.id = q.provider_id
       WHERE r.id = $1 AND r.status = 'PENDING_REVIEW'`,
      [reprintId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Reprint is unavailable for approval.');
    const eligible =
      row.qualification_id &&
      row.qualification_status === 'QUALIFIED' &&
      row.active &&
      row.provider_status === 'ENABLED' &&
      row.technical_compatible &&
      row.g3_reviewed &&
      row.physical_test_status === 'PASSED' &&
      row.shipping_enabled;
    if (approved && !eligible)
      throw new Error('Reprint provider must be requalified before approval.');
    await this.pool.query(
      `UPDATE app.order_reprints SET status = $2, approved_by_user_id = $3::uuid, approved_at = now(), notes = coalesce($4, notes) WHERE id = $1 AND status = 'PENDING_REVIEW'`,
      [reprintId, approved ? 'APPROVED' : 'REJECTED', session.userId, notes ?? null],
    );
    await this.audit(
      this.pool,
      row.order_id,
      approved ? 'reprint_approved' : 'reprint_rejected',
      session,
      null,
      { reprintId, revalidatedQualificationId: row.qualification_id, m7ControlsRequired: true },
    );
  }

  async recordProviderDefect(
    session: ActiveSession,
    input: { orderNumber: string; defectCode: string; reprintId?: string; notes?: string },
  ) {
    await this.requireCx(session);
    requireReason(input.defectCode, providerDefectCodes, 'provider defect');
    if (!session.userId) throw new Error('Operations access is restricted.');
    const source = await this.pool.query<{
      order_id: string;
      provider_id: string | null;
      order_item_id: string | null;
      product_model_id: string | null;
      product_variant_id: string | null;
      external_fulfillment_order_id: string | null;
    }>(
      `SELECT o.id AS order_id, q.provider_id, i.id AS order_item_id, i.product_model_id, i.product_variant_id, e.id AS external_fulfillment_order_id
       FROM app.orders o
       LEFT JOIN app.order_items i ON i.order_id = o.id
       LEFT JOIN app.external_fulfillment_orders e ON e.order_id = o.id
       LEFT JOIN LATERAL (SELECT selected_qualification_id FROM app.order_final_routing WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) r ON true
       LEFT JOIN app.provider_qualifications q ON q.id = r.selected_qualification_id WHERE o.order_number = $1 LIMIT 1`,
      [input.orderNumber],
    );
    const row = source.rows[0];
    if (!row) throw new Error('Order is unavailable.');
    await this.pool.query(
      `INSERT INTO app.provider_defects (order_id, order_item_id, product_model_id, product_variant_id, external_fulfillment_order_id, reprint_id, provider_id, defect_code, notes, recorded_by_user_id) VALUES ($1,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7,$8,$9,$10::uuid)`,
      [
        row.order_id,
        row.order_item_id,
        row.product_model_id,
        row.product_variant_id,
        row.external_fulfillment_order_id,
        input.reprintId ?? null,
        row.provider_id,
        input.defectCode,
        input.notes ?? null,
        session.userId,
      ],
    );
    await this.audit(
      this.pool,
      row.order_id,
      'provider_defect_recorded',
      session,
      input.defectCode,
      {
        reprintId: input.reprintId ?? null,
        providerId: row.provider_id,
        productModelId: row.product_model_id,
        productVariantId: row.product_variant_id,
      },
    );
  }

  private async requireCx(session: ActiveSession) {
    if (!session.userId) throw new Error('Operations access is restricted.');
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.users WHERE id = $1`,
      [session.userId],
    );
    if (!['ADMIN', 'CX_OPS', 'FULFILLMENT_ADMIN'].includes(result.rows[0]?.role ?? ''))
      throw new Error('Operations access is restricted.');
  }

  private async audit(
    client: {
      query<T>(
        text: string,
        values?: readonly unknown[],
      ): Promise<{ rows: T[]; rowCount: number | null }>;
    },
    orderId: string,
    action: string,
    actor: ActiveSession,
    reasonCode: string | null,
    metadata: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO app.order_operational_audits (order_id, action, actor_type, actor_user_id, reason_code, metadata) VALUES ($1, $2, 'OPS', $3::uuid, $4, $5::jsonb)`,
      [orderId, action, actor.userId, reasonCode, JSON.stringify(metadata)],
    );
  }
}
