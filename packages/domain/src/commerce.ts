import { createHash, randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { ActiveSession } from './identity';
import type { FulfillmentService, NormalizedShippingQuote } from './fulfillment-contracts';
import type { PaymentService, TaxService, VerifiedPaymentEvent } from './commerce-contracts';

const currency = 'USD' as const;

export class CommerceAccessError extends Error {}
export class CommerceValidationError extends Error {}

export interface CommerceConfiguration {
  pricingVersion: string;
  freeShippingThresholdCents: number;
  quantityDiscounts: Array<{ minimumQuantity: number; basisPoints: number }>;
  quoteTtlMinutes: number;
}

export const developmentCommerceConfiguration: CommerceConfiguration = {
  pricingVersion: 'development-retail-v1',
  freeShippingThresholdCents: 7_500,
  quantityDiscounts: [{ minimumQuantity: 3, basisPoints: 1_000 }],
  quoteTtlMinutes: 20,
};

export interface CartLineInput {
  projectId: string;
  size: string;
  quantity: number;
}

export interface ShippingAddressInput {
  recipientName: string;
  email: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
}

export interface CartView {
  id: string;
  revision: number;
  status: string;
  currency: 'USD';
  item: {
    id: string;
    projectId: string;
    projectVersionId: string;
    prepressRunId: string;
    mockupId: string;
    previewAssetId: string;
    productModelId: string;
    productName: string;
    variantId: string;
    colorCode: string;
    colorName: string;
    size: string;
    quantity: number;
  } | null;
  proofApproved: boolean;
}

export interface CheckoutView {
  id: string;
  status: string;
  amountCents: number;
  currency: 'USD';
  clientSecret: string | null;
  pricing: PricingSnapshot;
  shipping: ShippingSnapshot;
  tax: TaxSnapshot;
}

export interface PricingSnapshot {
  unitRetailCents: number;
  quantity: number;
  discountCents: number;
  subtotalCents: number;
  customerShippingCents: number;
  freeShippingApplied: boolean;
  taxCents: number;
  totalCents: number;
  currency: 'USD';
  pricingVersion: string;
}

export interface ShippingSnapshot {
  method: string;
  customerShippingCents: number;
  providerShippingCostCents: number;
  currency: 'USD';
  estimatedDeliveryMinDays: number | null;
  estimatedDeliveryMaxDays: number | null;
  estimateKind: string;
  expiresAt: string;
  provisional: true;
}

export interface TaxSnapshot {
  provider: string;
  providerCalculationId: string | null;
  taxableSubtotalCents: number;
  shippingTaxCents: number;
  taxCents: number;
  currency: 'USD';
  calculatedAt: string;
  configurationVersion: string;
}

interface CartRow {
  id: string;
  revision: number;
  status: string;
  currency: 'USD';
}

interface ItemRow {
  id: string;
  project_id: string;
  project_version_id: string;
  prepress_run_id: string;
  mockup_id: string;
  preview_asset_id: string;
  product_model_id: string;
  product_name: string;
  product_variant_id: string;
  color_code: string;
  color_name: string;
  size: string;
  quantity: number;
  unit_price_cents: number;
  product_snapshot: {
    styleFamilyId?: string | null;
    presetId?: string | null;
    presetVersion?: number | null;
  };
}

interface ProjectForCartRow {
  project_id: string;
  project_version_id: string;
  product_model_id: string;
  selected_color_code: string;
  product_name: string;
  prepress_run_id: string;
  prepress_status: string;
  preview_asset_id: string;
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
}

interface VariantRow {
  id: string;
  color_code: string;
  color_name: string;
  size: string;
  price_cents: number;
}

interface MockupRow {
  id: string;
  preview_asset_id: string;
  state_hash: string;
}

export class CommerceService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
    private readonly taxes: TaxService,
    private readonly fulfillment: FulfillmentService,
    private readonly configuration: CommerceConfiguration = developmentCommerceConfiguration,
  ) {}

  async createCart(session: ActiveSession, input: CartLineInput): Promise<CartView> {
    validateQuantity(input.quantity);
    const source = await this.projectForCart(session, input.projectId);
    requireCheckoutReady(source.prepress_status);
    const variant = await this.variant(
      source.product_model_id,
      source.selected_color_code,
      input.size,
    );
    const mockup = await this.mockupFor(source);
    const cartId = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO app.carts (id, owner_type, owner_session_id, owner_user_id, status, currency, expires_at)
         VALUES ($1, $2, $3, $4, 'READY', 'USD', now() + interval '7 days')`,
        [
          cartId,
          session.userId ? 'USER' : 'GUEST',
          session.userId ? null : session.id,
          session.userId,
        ],
      );
      await client.query(
        `INSERT INTO app.cart_items (
           cart_id, project_id, project_version_id, prepress_run_id, mockup_id, product_model_id,
           product_variant_id, color_code, size, quantity, product_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          cartId,
          source.project_id,
          source.project_version_id,
          source.prepress_run_id,
          mockup.id,
          source.product_model_id,
          variant.id,
          variant.color_code,
          variant.size,
          input.quantity,
          JSON.stringify({
            displayName: source.product_name,
            colorName: variant.color_name,
            colorCode: variant.color_code,
            size: variant.size,
            unitRetailCents: variant.price_cents,
            developmentOnly: true,
            styleFamilyId: source.style_family_id,
            presetId: source.style_preset_id,
            presetVersion: source.style_preset_version,
          }),
        ],
      );
      await this.recordAnalytics(client, 'add_to_cart', source.project_id, {
        productId: source.product_model_id,
        colorCode: variant.color_code,
        size: variant.size,
        quantity: input.quantity,
        ...styleDimensions({
          styleFamilyId: source.style_family_id,
          presetId: source.style_preset_id,
          presetVersion: source.style_preset_version,
        }),
      });
    });
    return this.getCart(session, cartId);
  }

  async getCart(session: ActiveSession, cartId: string): Promise<CartView> {
    const cart = await this.cart(session, cartId);
    const result = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, m.preview_asset_id,
              i.product_model_id, p.display_name AS product_name, i.product_variant_id, i.color_code,
              v.color_name, i.size, i.quantity, v.price_cents AS unit_price_cents, i.product_snapshot
       FROM app.cart_items i JOIN app.mockups m ON m.id = i.mockup_id
       JOIN app.product_models p ON p.id = i.product_model_id
       JOIN app.product_variants v ON v.id = i.product_variant_id
       WHERE i.cart_id = $1 ORDER BY i.created_at LIMIT 1`,
      [cartId],
    );
    const item = result.rows[0];
    if (item) {
      const current = await this.pool.query<{
        active_version_id: string;
        selected_color_code: string;
      }>(
        `SELECT p.active_version_id, p.selected_color_code FROM app.projects p
         WHERE p.id = $1 AND ${projectOwnershipClause(2, 3)}`,
        [item.project_id, session.id, session.userId],
      );
      const state = current.rows[0];
      if (
        !state ||
        state.active_version_id !== item.project_version_id ||
        state.selected_color_code !== item.color_code
      ) {
        await this.pool.query(
          `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(), invalidation_reason = 'The design or product selection changed.' WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
          [item.id],
        );
      }
    }
    const approved = item
      ? await this.pool.query<{ id: string }>(
          `SELECT pa.id FROM app.proof_approvals pa
           WHERE pa.cart_item_id = $1 AND pa.approval_state = 'APPROVED'
             AND pa.project_version_id = $2 AND pa.prepress_run_id = $3 AND pa.mockup_id = $4
           ORDER BY pa.approved_at DESC LIMIT 1`,
          [item.id, item.project_version_id, item.prepress_run_id, item.mockup_id],
        )
      : { rows: [] as { id: string }[] };
    return {
      id: cart.id,
      revision: cart.revision,
      status: cart.status,
      currency: cart.currency,
      item: item
        ? {
            id: item.id,
            projectId: item.project_id,
            projectVersionId: item.project_version_id,
            prepressRunId: item.prepress_run_id,
            mockupId: item.mockup_id,
            previewAssetId: item.preview_asset_id,
            productModelId: item.product_model_id,
            productName: item.product_name,
            variantId: item.product_variant_id,
            colorCode: item.color_code,
            colorName: item.color_name,
            size: item.size,
            quantity: item.quantity,
          }
        : null,
      proofApproved: Boolean(approved.rows[0]),
    };
  }

  async approveProof(session: ActiveSession, cartId: string): Promise<void> {
    const item = await this.itemForCart(session, cartId);
    await this.assertImmutableItemState(session, item);
    await this.pool.query(
      `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(),
       invalidation_reason = 'Superseded by a new approval.'
       WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
      [item.id],
    );
    await this.pool.query(
      `INSERT INTO app.proof_approvals (
         cart_item_id, project_id, project_version_id, prepress_run_id, mockup_id, product_model_id, color_code,
         approval_state, state_hash, approved_by_session_id, approved_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED', $8, $9, $10)`,
      [
        item.id,
        item.project_id,
        item.project_version_id,
        item.prepress_run_id,
        item.mockup_id,
        item.product_model_id,
        item.color_code,
        proofStateHash(item),
        session.id,
        session.userId,
      ],
    );
    await this.pool.query(
      `UPDATE app.carts SET revision = revision + 1, updated_at = now() WHERE id = $1`,
      [cartId],
    );
    await this.pool.query(
      `INSERT INTO app.analytics_events (event_name, project_id, dimensions) VALUES ('proof_approved', $1, $2::jsonb)`,
      [
        item.project_id,
        JSON.stringify({
          productId: item.product_model_id,
          colorCode: item.color_code,
          ...styleDimensions(item.product_snapshot),
        }),
      ],
    );
  }

  async saveShippingAddress(
    session: ActiveSession,
    cartId: string,
    input: ShippingAddressInput,
  ): Promise<string> {
    await this.cart(session, cartId);
    validateAddress(input);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO app.shipping_addresses (
         cart_id, recipient_name, email, phone, line1, line2, city, state_code, postal_code, country_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        cartId,
        input.recipientName.trim(),
        input.email.trim().toLowerCase(),
        input.phone?.trim() || null,
        input.line1.trim(),
        input.line2?.trim() || null,
        input.city.trim(),
        input.stateCode.trim().toUpperCase(),
        input.postalCode.trim(),
        input.countryCode.trim().toUpperCase(),
      ],
    );
    return requireRow(result.rows[0], 'Could not save your shipping address.').id;
  }

  async startCheckout(
    session: ActiveSession,
    cartId: string,
    addressId: string,
    idempotencyKey: string,
  ): Promise<CheckoutView> {
    if (!idempotencyKey || idempotencyKey.length < 12)
      throw new CommerceValidationError('A checkout idempotency key is required.');
    const existing = await this.pool.query<{ id: string }>(
      `SELECT ca.id FROM app.checkout_attempts ca JOIN app.carts c ON c.id = ca.cart_id
       WHERE ca.idempotency_key = $1 AND ${cartOwnershipClause(2, 3)}`,
      [idempotencyKey, session.id, session.userId],
    );
    if (existing.rows[0]) return this.getCheckout(session, existing.rows[0].id);
    const active = await this.pool.query<{ id: string }>(
      `SELECT ca.id FROM app.checkout_attempts ca JOIN app.carts c ON c.id = ca.cart_id
       WHERE ca.cart_id = $1 AND ca.status IN ('READY', 'PAYMENT_PENDING') AND ${cartOwnershipClause(2, 3)}
       ORDER BY ca.created_at DESC LIMIT 1`,
      [cartId, session.id, session.userId],
    );
    if (active.rows[0]) return this.getCheckout(session, active.rows[0].id);
    const item = await this.itemForCart(session, cartId);
    await this.assertImmutableItemState(session, item);
    await this.assertProof(item);
    const address = await this.address(session, cartId, addressId);
    const quote = await this.provisionalQuote(item, address.country_code);
    const pricing = this.price(item.unit_price_cents, item.quantity, quote.shippingCents);
    const tax = await this.taxes.calculate({
      subtotalCents: pricing.subtotalCents,
      customerShippingCents: pricing.customerShippingCents,
      address: {
        countryCode: address.country_code,
        stateCode: address.state_code,
        postalCode: address.postal_code,
      },
    });
    const taxSnapshot: TaxSnapshot = {
      provider: tax.provider,
      providerCalculationId: tax.providerCalculationId,
      taxableSubtotalCents: tax.taxableSubtotalCents,
      shippingTaxCents: tax.shippingTaxCents,
      taxCents: tax.taxCents,
      currency,
      calculatedAt: tax.calculatedAt.toISOString(),
      configurationVersion: tax.configurationVersion,
    };
    const pricingWithTax: PricingSnapshot = {
      ...pricing,
      taxCents: tax.taxCents,
      totalCents: pricing.subtotalCents + pricing.customerShippingCents + tax.taxCents,
    };
    const expiry =
      quote.expiresAt && quote.expiresAt > new Date()
        ? quote.expiresAt
        : new Date(Date.now() + this.configuration.quoteTtlMinutes * 60_000);
    const attemptId = randomUUID();
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO app.checkout_attempts (
         id, cart_id, shipping_address_id, status, idempotency_key, currency, amount_cents,
         pricing_snapshot, shipping_snapshot, tax_snapshot, payment_provider, price_expires_at
       ) VALUES ($1, $2, $3, 'PAYMENT_PENDING', $4, 'USD', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10) RETURNING id`,
      [
        attemptId,
        cartId,
        addressId,
        idempotencyKey,
        pricingWithTax.totalCents,
        JSON.stringify(pricingWithTax),
        JSON.stringify(toShippingSnapshot(quote, pricingWithTax.customerShippingCents, expiry)),
        JSON.stringify(taxSnapshot),
        this.paymentProvider(),
        expiry,
      ],
    );
    if (!inserted.rows[0]) return this.getCheckout(session, attemptId);
    const intent = await this.payments.createIntent({
      checkoutAttemptId: attemptId,
      amountCents: pricingWithTax.totalCents,
      currency,
      idempotencyKey,
      customerEmail: address.email,
    });
    await this.pool.query(
      `UPDATE app.checkout_attempts SET provider_payment_id = $2, provider_client_secret = $3, updated_at = now() WHERE id = $1`,
      [attemptId, intent.providerPaymentId, intent.clientSecret],
    );
    await this.pool.query(
      `UPDATE app.carts SET status = 'CHECKOUT_CREATED', updated_at = now() WHERE id = $1`,
      [cartId],
    );
    await this.pool.query(
      `INSERT INTO app.analytics_events (event_name, project_id, dimensions) VALUES ('checkout_started', $1, $2::jsonb)`,
      [
        item.project_id,
        JSON.stringify({
          productId: item.product_model_id,
          colorCode: item.color_code,
          size: item.size,
          ...styleDimensions(item.product_snapshot),
        }),
      ],
    );
    return this.getCheckout(session, attemptId);
  }

  async getCheckout(session: ActiveSession, checkoutId: string): Promise<CheckoutView> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      amount_cents: number;
      currency: 'USD';
      provider_client_secret: string | null;
      pricing_snapshot: PricingSnapshot;
      shipping_snapshot: ShippingSnapshot;
      tax_snapshot: TaxSnapshot;
    }>(
      `SELECT ca.id, ca.status, ca.amount_cents, ca.currency, ca.provider_client_secret,
              ca.pricing_snapshot, ca.shipping_snapshot, ca.tax_snapshot
       FROM app.checkout_attempts ca JOIN app.carts c ON c.id = ca.cart_id
       WHERE ca.id = $1 AND ${cartOwnershipClause(2, 3)}`,
      [checkoutId, session.id, session.userId],
    );
    const row = requireRow(result.rows[0], 'Checkout not found.');
    return {
      id: row.id,
      status: row.status,
      amountCents: row.amount_cents,
      currency: row.currency,
      clientSecret: row.provider_client_secret,
      pricing: row.pricing_snapshot,
      shipping: row.shipping_snapshot,
      tax: row.tax_snapshot,
    };
  }

  /** Local/CI-only helper that still enters through the verified webhook code path. */
  async simulateFakePayment(
    session: ActiveSession,
    checkoutId: string,
    outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING',
  ): Promise<{ duplicate: boolean; orderNumber: string | null }> {
    await this.getCheckout(session, checkoutId);
    const result = await this.pool.query<{
      provider_payment_id: string | null;
      amount_cents: number;
    }>(
      `SELECT provider_payment_id, amount_cents FROM app.checkout_attempts WHERE id = $1 AND payment_provider = 'FAKE'`,
      [checkoutId],
    );
    const attempt = requireRow(result.rows[0], 'Fake payment is unavailable for this checkout.');
    const type =
      outcome === 'SUCCEEDED'
        ? 'payment_intent.succeeded'
        : outcome === 'FAILED'
          ? 'payment_intent.payment_failed'
          : outcome === 'CANCELLED'
            ? 'payment_intent.canceled'
            : 'payment_intent.processing';
    return this.ingestPaymentWebhook({
      signature: 'fake-payment-signature',
      body: JSON.stringify({
        id: `fake_evt_${checkoutId}_${outcome.toLowerCase()}`,
        type,
        data: {
          object: {
            id: attempt.provider_payment_id,
            amount: attempt.amount_cents,
            currency: 'usd',
            metadata: { checkoutAttemptId: checkoutId },
          },
        },
      }),
    });
  }

  /** Payment ingestion intentionally owns only payment/order persistence; it imports no fulfillment service. */
  async ingestPaymentWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<{ duplicate: boolean; orderNumber: string | null }> {
    const event = await this.payments.verifyWebhook(input);
    if (!event) throw new CommerceAccessError('Payment webhook signature is invalid.');
    return withTransaction(this.pool, async (client) => this.persistPaymentEvent(client, event));
  }

  async getOrder(
    session: ActiveSession,
    orderNumber: string,
  ): Promise<{
    orderNumber: string;
    status: string;
    customerEmail: string;
    pricing: PricingSnapshot;
  } | null> {
    const result = await this.pool.query<{
      order_number: string;
      status: string;
      customer_email: string;
      pricing_snapshot: PricingSnapshot;
    }>(
      `SELECT order_number, status, customer_email, pricing_snapshot FROM app.orders
       WHERE order_number = $1 AND ((owner_type = 'GUEST' AND owner_session_id = $2) OR (owner_type = 'USER' AND owner_user_id = $3::uuid))`,
      [orderNumber, session.id, session.userId],
    );
    const row = result.rows[0];
    return row
      ? {
          orderNumber: row.order_number,
          status: row.status,
          customerEmail: row.customer_email,
          pricing: row.pricing_snapshot,
        }
      : null;
  }

  private async persistPaymentEvent(
    client: SqlClient,
    event: VerifiedPaymentEvent,
  ): Promise<{ duplicate: boolean; orderNumber: string | null }> {
    const eventInsert = await client.query<{ id: string }>(
      `INSERT INTO app.payment_events (provider, provider_event_id, event_name, verification_status, normalized_payload, processed_at)
       VALUES ($1, $2, $3, 'VERIFIED', $4::jsonb, now()) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
      [event.provider, event.providerEventId, event.eventName, JSON.stringify(event)],
    );
    if (!eventInsert.rows[0]) {
      const existing = await client.query<{ order_number: string }>(
        `SELECT o.order_number FROM app.orders o JOIN app.checkout_attempts ca ON ca.id = o.checkout_attempt_id WHERE ca.provider_payment_id = $1`,
        [event.paymentId],
      );
      return { duplicate: true, orderNumber: existing.rows[0]?.order_number ?? null };
    }
    const attempt = await client.query<{
      id: string;
      cart_id: string;
      amount_cents: number;
      currency: 'USD';
      status: string;
      price_expires_at: Date;
      pricing_snapshot: PricingSnapshot;
      shipping_snapshot: ShippingSnapshot;
      shipping_address_id: string;
    }>(
      `SELECT id, cart_id, amount_cents, currency, status, price_expires_at, pricing_snapshot, shipping_snapshot, shipping_address_id
       FROM app.checkout_attempts WHERE provider_payment_id = $1 FOR UPDATE`,
      [event.paymentId],
    );
    const checkout = requireRow(attempt.rows[0], 'Payment does not match a checkout attempt.');
    if (checkout.price_expires_at <= new Date()) {
      await client.query(
        `UPDATE app.checkout_attempts SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
        [checkout.id],
      );
      throw new CommerceValidationError(
        'Your delivery estimate expired. Refresh checkout before payment.',
      );
    }
    if (event.amountCents !== checkout.amount_cents || event.currency !== checkout.currency) {
      throw new CommerceValidationError('Payment amount does not match the server checkout total.');
    }
    const status = paymentStatus(event.outcome);
    await client.query(
      `INSERT INTO app.payments (checkout_attempt_id, provider, provider_payment_id, status, amount_cents, currency, provider_fee_cents, provider_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (checkout_attempt_id) DO UPDATE SET status = EXCLUDED.status, provider_fee_cents = COALESCE(EXCLUDED.provider_fee_cents, app.payments.provider_fee_cents), updated_at = now()`,
      [
        checkout.id,
        event.provider,
        event.paymentId,
        status,
        event.amountCents,
        event.currency,
        event.providerFeeCents,
        JSON.stringify(event.metadata),
      ],
    );
    await client.query(
      `UPDATE app.checkout_attempts SET status = $2, updated_at = now() WHERE id = $1`,
      [checkout.id, checkoutStatus(event.outcome)],
    );
    if (event.outcome !== 'SUCCEEDED') return { duplicate: false, orderNumber: null };
    const existing = await client.query<{ order_number: string }>(
      `SELECT order_number FROM app.orders WHERE checkout_attempt_id = $1`,
      [checkout.id],
    );
    if (existing.rows[0]) return { duplicate: false, orderNumber: existing.rows[0].order_number };
    const created = await client.query<{ order_number: string }>(
      `INSERT INTO app.orders (
         order_number, cart_id, checkout_attempt_id, owner_type, owner_session_id, owner_user_id, customer_email,
         shipping_address_snapshot, status, pricing_snapshot, financial_snapshot
       ) SELECT $1, c.id, $2, c.owner_type, c.owner_session_id, c.owner_user_id, a.email,
                jsonb_build_object('recipientName', a.recipient_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city, 'stateCode', a.state_code, 'postalCode', a.postal_code, 'countryCode', a.country_code),
                'PAID', $3::jsonb, $4::jsonb
         FROM app.carts c JOIN app.shipping_addresses a ON a.id = $5 WHERE c.id = $6 RETURNING order_number`,
      [
        orderNumber(),
        checkout.id,
        JSON.stringify(checkout.pricing_snapshot),
        JSON.stringify({
          revenueCents: checkout.pricing_snapshot.subtotalCents,
          discountCents: checkout.pricing_snapshot.discountCents,
          customerShippingRevenueCents: checkout.pricing_snapshot.customerShippingCents,
          taxCollectedCents: checkout.pricing_snapshot.taxCents,
          paymentFeeCents: event.providerFeeCents,
          estimatedProviderShippingCostCents: checkout.shipping_snapshot.providerShippingCostCents,
          status: 'ESTIMATED',
        }),
        checkout.shipping_address_id,
        checkout.cart_id,
      ],
    );
    const orderNumberValue = requireRow(
      created.rows[0],
      'Could not create paid order.',
    ).order_number;
    await client.query(
      `INSERT INTO app.order_items (order_id, cart_item_id, project_id, project_version_id, prepress_run_id, mockup_id, product_model_id, product_variant_id, quantity, item_snapshot)
       SELECT o.id, i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, i.product_model_id, i.product_variant_id, i.quantity, i.product_snapshot
       FROM app.orders o JOIN app.cart_items i ON i.cart_id = o.cart_id WHERE o.order_number = $1`,
      [orderNumberValue],
    );
    await client.query(
      `INSERT INTO app.order_state_history (order_id, from_state, to_state, reason, actor_type)
      SELECT id, 'PAYMENT_PENDING', 'PAID', 'Verified payment webhook', 'SYSTEM' FROM app.orders WHERE order_number = $1`,
      [orderNumberValue],
    );
    await client.query(
      `UPDATE app.carts SET status = 'COMPLETED', updated_at = now() WHERE id = $1`,
      [checkout.cart_id],
    );
    await client.query(
      `INSERT INTO app.analytics_events (event_name, project_id, dimensions)
       SELECT 'payment_succeeded', i.project_id, i.product_snapshot || jsonb_build_object('productId', i.product_model_id, 'colorCode', i.color_code, 'orderNumber', $1::text)
       FROM app.cart_items i WHERE i.cart_id = $2 LIMIT 1`,
      [orderNumberValue, checkout.cart_id],
    );
    return { duplicate: false, orderNumber: orderNumberValue };
  }

  private async projectForCart(
    session: ActiveSession,
    projectId: string,
  ): Promise<ProjectForCartRow> {
    const result = await this.pool.query<ProjectForCartRow>(
      `SELECT p.id AS project_id, pv.id AS project_version_id, p.product_model_id, p.selected_color_code,
              pm.display_name AS product_name, r.id AS prepress_run_id, r.status AS prepress_status, r.preview_asset_id,
              p.style_family_id, p.style_preset_id, p.style_preset_version
       FROM app.projects p JOIN app.project_versions pv ON pv.id = p.active_version_id
       JOIN app.product_models pm ON pm.id = p.product_model_id
       JOIN LATERAL (SELECT * FROM app.prepress_runs WHERE project_id = p.id AND project_version_id = pv.id ORDER BY created_at DESC LIMIT 1) r ON true
       WHERE p.id = $1 AND ${projectOwnershipClause(2, 3)}`,
      [projectId, session.id, session.userId],
    );
    return requireRow(result.rows[0], 'A current print-ready project is required.');
  }

  private async variant(productId: string, colorCode: string, size: string): Promise<VariantRow> {
    const result = await this.pool.query<VariantRow>(
      `SELECT id, color_code, color_name, size, price_cents FROM app.product_variants
       WHERE product_model_id = $1 AND color_code = $2 AND size = $3 AND status = 'ACTIVE'`,
      [productId, colorCode, size],
    );
    return requireRow(result.rows[0], 'That size is not available for this T-shirt.');
  }

  private async mockupFor(source: ProjectForCartRow): Promise<MockupRow> {
    const stateHash = proofStateHash(source);
    const existing = await this.pool.query<MockupRow>(
      `SELECT id, preview_asset_id, state_hash FROM app.mockups WHERE project_version_id = $1 AND prepress_run_id = $2 AND renderer = 'CONTROLLED_PREPRESS_PREVIEW' AND renderer_version = 'v1'`,
      [source.project_version_id, source.prepress_run_id],
    );
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await this.pool.query<MockupRow>(
      `INSERT INTO app.mockups (project_id, project_version_id, prepress_run_id, product_model_id, color_code, preview_asset_id, renderer, renderer_version, state_hash)
       VALUES ($1, $2, $3, $4, $5, $6, 'CONTROLLED_PREPRESS_PREVIEW', 'v1', $7) RETURNING id, preview_asset_id, state_hash`,
      [
        source.project_id,
        source.project_version_id,
        source.prepress_run_id,
        source.product_model_id,
        source.selected_color_code,
        source.preview_asset_id,
        stateHash,
      ],
    );
    return requireRow(inserted.rows[0], 'Could not create your product proof.');
  }

  private async cart(session: ActiveSession, cartId: string): Promise<CartRow> {
    const result = await this.pool.query<CartRow>(
      `SELECT c.id, c.revision, c.status, c.currency FROM app.carts c WHERE c.id = $1 AND ${cartOwnershipClause(2, 3)}`,
      [cartId, session.id, session.userId],
    );
    return requireRow(result.rows[0], 'Cart not found.');
  }

  private async itemForCart(session: ActiveSession, cartId: string): Promise<ItemRow> {
    await this.cart(session, cartId);
    const result = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, m.preview_asset_id, i.product_model_id,
              pm.display_name AS product_name, i.product_variant_id, i.color_code, v.color_name, i.size, i.quantity, v.price_cents AS unit_price_cents, i.product_snapshot
       FROM app.cart_items i JOIN app.mockups m ON m.id = i.mockup_id JOIN app.product_models pm ON pm.id = i.product_model_id JOIN app.product_variants v ON v.id = i.product_variant_id
       WHERE i.cart_id = $1 ORDER BY i.created_at LIMIT 1`,
      [cartId],
    );
    return requireRow(result.rows[0], 'Cart has no items.');
  }

  private async assertImmutableItemState(session: ActiveSession, item: ItemRow): Promise<void> {
    const current = await this.pool.query<{
      active_version_id: string;
      selected_color_code: string;
    }>(
      `SELECT p.active_version_id, p.selected_color_code FROM app.projects p
       WHERE p.id = $1 AND ${projectOwnershipClause(2, 3)}`,
      [item.project_id, session.id, session.userId],
    );
    const state = requireRow(current.rows[0], 'Project not found.');
    if (
      state.active_version_id !== item.project_version_id ||
      state.selected_color_code !== item.color_code
    ) {
      await this.pool.query(
        `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(), invalidation_reason = 'The design or product selection changed.' WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
        [item.id],
      );
      throw new CommerceValidationError(
        'Your design changed. Create a fresh cart and approve the updated proof.',
      );
    }
    const source = await this.projectForCart(session, item.project_id);
    if (source.prepress_run_id !== item.prepress_run_id) {
      await this.pool.query(
        `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(), invalidation_reason = 'The design or product selection changed.' WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
        [item.id],
      );
      throw new CommerceValidationError(
        'Your design changed. Create a fresh cart and approve the updated proof.',
      );
    }
    requireCheckoutReady(source.prepress_status);
  }

  private async assertProof(item: ItemRow): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM app.proof_approvals WHERE cart_item_id = $1 AND approval_state = 'APPROVED' AND project_version_id = $2 AND prepress_run_id = $3 AND mockup_id = $4`,
      [item.id, item.project_version_id, item.prepress_run_id, item.mockup_id],
    );
    if (!result.rows[0])
      throw new CommerceValidationError(
        'Please review and approve this exact proof before payment.',
      );
  }

  private async address(
    session: ActiveSession,
    cartId: string,
    addressId: string,
  ): Promise<{ email: string; country_code: string; state_code: string; postal_code: string }> {
    await this.cart(session, cartId);
    const result = await this.pool.query<{
      email: string;
      country_code: string;
      state_code: string;
      postal_code: string;
    }>(
      `SELECT email, country_code, state_code, postal_code FROM app.shipping_addresses WHERE id = $1 AND cart_id = $2`,
      [addressId, cartId],
    );
    return requireRow(result.rows[0], 'Shipping address not found.');
  }

  private async provisionalQuote(
    item: ItemRow,
    destinationCountry: string,
  ): Promise<NormalizedShippingQuote> {
    const result = await this.pool.query<{
      external_provider_id: string;
      external_blueprint_id: string;
      external_variant_id: string;
    }>(
      `SELECT p.external_id AS external_provider_id, pm.external_blueprint_id, vm.external_variant_id
       FROM app.fulfillment_product_mappings pm JOIN app.fulfillment_variant_mappings vm ON vm.product_variant_id = $1
       JOIN app.print_providers p ON p.adapter_type = pm.adapter_type AND p.status = 'ENABLED'
       WHERE pm.product_model_id = $2 ORDER BY p.id LIMIT 1`,
      [item.product_variant_id, item.product_model_id],
    );
    const mapping = requireRow(result.rows[0], 'A provisional shipping estimate is not available.');
    return this.fulfillment.quoteShipping({
      externalProviderId: mapping.external_provider_id,
      externalBlueprintId: mapping.external_blueprint_id,
      externalVariantId: mapping.external_variant_id,
      destinationCountry,
    });
  }

  private price(
    unitRetailCents: number,
    quantity: number,
    providerShippingCents: number,
  ): PricingSnapshot {
    const gross = unitRetailCents * quantity;
    const discountRule = [...this.configuration.quantityDiscounts]
      .sort((a, b) => b.minimumQuantity - a.minimumQuantity)
      .find((rule) => quantity >= rule.minimumQuantity);
    const discountCents = discountRule
      ? Math.round((gross * discountRule.basisPoints) / 10_000)
      : 0;
    const subtotalCents = gross - discountCents;
    const freeShippingApplied = subtotalCents >= this.configuration.freeShippingThresholdCents;
    const customerShippingCents = freeShippingApplied ? 0 : providerShippingCents;
    return {
      unitRetailCents,
      quantity,
      discountCents,
      subtotalCents,
      customerShippingCents,
      freeShippingApplied,
      taxCents: 0,
      totalCents: subtotalCents + customerShippingCents,
      currency,
      pricingVersion: this.configuration.pricingVersion,
    };
  }

  private paymentProvider(): 'FAKE' | 'STRIPE' {
    return this.payments.constructor.name === 'StripePaymentService' ? 'STRIPE' : 'FAKE';
  }
  private async recordAnalytics(
    client: SqlClient,
    name: string,
    projectId: string,
    dimensions: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.analytics_events (event_name, project_id, dimensions) VALUES ($1, $2, $3::jsonb)`,
      [name, projectId, JSON.stringify(dimensions)],
    );
  }
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new CommerceValidationError('Choose a quantity from 1 to 99.');
}
function validateAddress(address: ShippingAddressInput): void {
  if (
    !address.recipientName.trim() ||
    !/^\S+@\S+\.\S+$/.test(address.email) ||
    !address.line1.trim() ||
    !address.city.trim() ||
    !/^[A-Za-z]{2}$/.test(address.stateCode) ||
    !/^\d{5}(?:-\d{4})?$/.test(address.postalCode) ||
    address.countryCode.trim().toUpperCase() !== 'US'
  ) {
    throw new CommerceValidationError('Enter a complete US shipping address and a valid email.');
  }
}
function requireCheckoutReady(status: string): void {
  if (!['PASSED', 'REVIEW_REQUIRED'].includes(status))
    throw new CommerceValidationError(
      status === 'BLOCKED'
        ? 'Fix the print-quality issues before checkout.'
        : 'Finish the print-quality check before checkout.',
    );
}
function projectOwnershipClause(sessionPosition: number, userPosition: number): string {
  return `((p.owner_type = 'GUEST' AND p.owner_session_id = $${sessionPosition}) OR (p.owner_type = 'USER' AND p.owner_user_id = $${userPosition}::uuid))`;
}
function cartOwnershipClause(sessionPosition: number, userPosition: number): string {
  return `((c.owner_type = 'GUEST' AND c.owner_session_id = $${sessionPosition}) OR (c.owner_type = 'USER' AND c.owner_user_id = $${userPosition}::uuid))`;
}
function requireRow<T>(value: T | undefined, message: string): T {
  if (!value) throw new CommerceAccessError(message);
  return value;
}
function proofStateHash(value: {
  project_id: string;
  project_version_id: string;
  prepress_run_id: string;
  product_model_id: string;
  selected_color_code?: string;
  color_code?: string;
  mockup_id?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: value.project_id,
        projectVersionId: value.project_version_id,
        prepressRunId: value.prepress_run_id,
        productId: value.product_model_id,
        colorCode: value.selected_color_code ?? value.color_code,
        mockupId: value.mockup_id ?? null,
      }),
    )
    .digest('hex');
}
function toShippingSnapshot(
  quote: NormalizedShippingQuote,
  customerShippingCents: number,
  expiresAt: Date,
): ShippingSnapshot {
  return {
    method: quote.method,
    customerShippingCents,
    providerShippingCostCents: quote.shippingCents,
    currency,
    estimatedDeliveryMinDays: quote.estimatedDeliveryMinDays,
    estimatedDeliveryMaxDays: quote.estimatedDeliveryMaxDays,
    estimateKind: quote.estimateKind,
    expiresAt: expiresAt.toISOString(),
    provisional: true,
  };
}
function paymentStatus(outcome: VerifiedPaymentEvent['outcome']): string {
  return outcome === 'SUCCEEDED'
    ? 'SUCCEEDED'
    : outcome === 'FAILED'
      ? 'FAILED'
      : outcome === 'CANCELLED'
        ? 'CANCELLED'
        : 'PENDING';
}
function checkoutStatus(outcome: VerifiedPaymentEvent['outcome']): string {
  return outcome === 'SUCCEEDED'
    ? 'PAID'
    : outcome === 'FAILED'
      ? 'PAYMENT_FAILED'
      : outcome === 'CANCELLED'
        ? 'PAYMENT_CANCELLED'
        : 'PAYMENT_PENDING';
}
function orderNumber(): string {
  return `LIB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}
function styleDimensions(value: {
  styleFamilyId?: string | null;
  presetId?: string | null;
  presetVersion?: number | null;
}): Record<string, unknown> {
  return {
    ...(value.styleFamilyId ? { styleFamilyId: value.styleFamilyId } : {}),
    ...(value.presetId ? { presetId: value.presetId } : {}),
    ...(value.presetVersion ? { presetVersion: value.presetVersion } : {}),
  };
}
