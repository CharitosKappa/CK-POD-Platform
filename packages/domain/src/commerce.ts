import { createHash, randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import { recordCustomerTouchpoint } from './customer-operations';

import type { ActiveSession } from './identity';
import type { FulfillmentService, NormalizedShippingQuote } from './fulfillment-contracts';
import type {
  BillingAddress,
  PaymentIntentResult,
  PaymentService,
  TaxService,
  VerifiedPaymentEvent,
} from './commerce-contracts';
import type { MockupService } from './mockups';
import type { LifecycleOrchestrator } from './operations-analytics';

const currency = 'USD' as const;

export class CommerceAccessError extends Error {}
export class CommerceValidationError extends Error {}

export interface CommerceConfiguration {
  pricingVersion: string;
  freeShippingThresholdCents: number;
  quantityDiscounts: Array<{ minimumQuantity: number; basisPoints: number }>;
  quoteTtlMinutes: number;
  /** Restrict local fake checkout quotes to development-only provider records. */
  developmentProviderOnly?: boolean;
  /** Optional adapter-owned provider IDs eligible for quoting in a constrained environment. */
  eligibleProviderExternalIds?: string[];
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
  saveToAccount?: boolean;
}

export interface BillingAddressInput {
  recipientName: string;
  line1: string;
  line2?: string;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
}

export interface CheckoutStartInput {
  shippingAddressId: string;
  /** `null` explicitly means that billing is identical to the delivery address. */
  billingAddress: BillingAddressInput | null;
  idempotencyKey: string;
}

export interface CartView {
  id: string;
  revision: number;
  status: string;
  currency: 'USD';
  /** All immutable cart lines, in the order they were added. */
  items: CartLineView[];
  /** @deprecated Use `items`. Kept temporarily for API compatibility. */
  item: CartLineView | null;
  /** True only when every cart line has an approved, current proof. */
  proofApproved: boolean;
}

export interface CartLineView {
  id: string;
  projectId: string;
  projectVersionId: string;
  prepressRunId: string;
  mockupId: string;
  previewAssetId: string;
  /** Artwork-only preview, fixed at the point the line enters the cart. */
  designPreviewAssetId: string | null;
  productModelId: string;
  productName: string;
  variantId: string;
  colorCode: string;
  colorName: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
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
  groups: FulfillmentShippingGroupSnapshot[];
}

export interface FulfillmentShippingGroupSnapshot {
  groupKey: string;
  providerId: string;
  qualificationId: string;
  method: string;
  shippingCents: number;
  estimatedDeliveryMinDays: number | null;
  estimatedDeliveryMaxDays: number | null;
  estimateKind: NormalizedShippingQuote['estimateKind'];
  expiresAt: string;
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
  design_preview_asset_id: string | null;
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

interface ShippingAddressRow {
  recipient_name: string;
  email: string;
  line1: string;
  line2: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  country_code: string;
}

interface FulfillmentPlanItem {
  item: ItemRow;
  externalBlueprintId: string;
  externalVariantId: string;
}

interface FulfillmentGroupPlan {
  groupKey: string;
  adapterType: 'PRINTIFY';
  providerId: string;
  qualificationId: string;
  externalProviderId: string;
  items: FulfillmentPlanItem[];
  quote: NormalizedShippingQuote;
}

export class CommerceService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly payments: PaymentService,
    private readonly taxes: TaxService,
    private readonly fulfillment: FulfillmentService,
    private readonly mockups: MockupService,
    private readonly configuration: CommerceConfiguration = developmentCommerceConfiguration,
    private readonly lifecycle?: LifecycleOrchestrator,
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
    const designPreviewAssetId = await this.designPreviewAssetId(source.prepress_run_id);
    let cartId = '';
    await withTransaction(this.pool, async (client) => {
      const activeCart = await client.query<{ id: string }>(
        `SELECT c.id FROM app.carts c
         WHERE c.status = 'READY' AND ${cartOwnershipClause(1, 2)}
         ORDER BY c.updated_at DESC LIMIT 1 FOR UPDATE`,
        [session.id, session.userId],
      );
      cartId = activeCart.rows[0]?.id ?? randomUUID();
      if (!activeCart.rows[0]) {
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
      }
      await client.query(
        `INSERT INTO app.cart_items (
           cart_id, project_id, project_version_id, prepress_run_id, mockup_id, design_preview_asset_id, product_model_id,
           product_variant_id, color_code, size, quantity, product_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          cartId,
          source.project_id,
          source.project_version_id,
          source.prepress_run_id,
          mockup.id,
          designPreviewAssetId,
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
      await client.query(
        `UPDATE app.carts SET revision = revision + 1, updated_at = now(), expires_at = now() + interval '7 days'
         WHERE id = $1`,
        [cartId],
      );
    });
    return this.getCart(session, cartId);
  }

  async getCart(session: ActiveSession, cartId: string): Promise<CartView> {
    const cart = await this.cart(session, cartId);
    const result = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, m.preview_asset_id,
              i.design_preview_asset_id,
              i.product_model_id, p.display_name AS product_name, i.product_variant_id, i.color_code,
              v.color_name, i.size, i.quantity, v.price_cents AS unit_price_cents, i.product_snapshot
       FROM app.cart_items i JOIN app.mockups m ON m.id = i.mockup_id
       JOIN app.product_models p ON p.id = i.product_model_id
       JOIN app.product_variants v ON v.id = i.product_variant_id
       WHERE i.cart_id = $1 ORDER BY i.created_at`,
      [cartId],
    );
    const cartItems = [...result.rows];
    for (let index = 0; index < cartItems.length; index += 1) {
      const cartItem = requireRow(cartItems[index], 'Cart has no items.');
      const current = await this.pool.query<{
        active_version_id: string;
        selected_color_code: string;
      }>(
        `SELECT p.active_version_id, p.selected_color_code FROM app.projects p
         WHERE p.id = $1 AND ${projectOwnershipClause(2, 3)}`,
        [cartItem.project_id, session.id, session.userId],
      );
      const state = current.rows[0];
      if (
        !state ||
        state.active_version_id !== cartItem.project_version_id ||
        state.selected_color_code !== cartItem.color_code
      ) {
        await this.pool.query(
          `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(),
           invalidation_reason = 'The design or product selection changed.'
           WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
          [cartItem.id],
        );
        continue;
      }
      const source = await this.projectForCart(session, cartItem.project_id);
      const currentMockup = await this.mockupFor(source);
      if (currentMockup.id !== cartItem.mockup_id) {
        await this.pool.query(
          `UPDATE app.cart_items SET mockup_id = $2, updated_at = now() WHERE id = $1`,
          [cartItem.id, currentMockup.id],
        );
        await this.pool.query(
          `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(),
           invalidation_reason = 'The product proof profile changed.'
           WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
          [cartItem.id],
        );
        cartItems[index] = {
          ...cartItem,
          mockup_id: currentMockup.id,
          preview_asset_id: currentMockup.preview_asset_id,
        };
      }
    }
    const items = cartItems.map(toCartLineView);
    const approved = await this.pool.query<{ cart_item_id: string }>(
      `SELECT pa.cart_item_id FROM app.proof_approvals pa
       JOIN app.cart_items i ON i.id = pa.cart_item_id
       WHERE i.cart_id = $1 AND pa.approval_state = 'APPROVED'
         AND pa.project_version_id = i.project_version_id
         AND pa.prepress_run_id = i.prepress_run_id
         AND pa.mockup_id = i.mockup_id`,
      [cartId],
    );
    const approvedItemIds = new Set(approved.rows.map((row) => row.cart_item_id));
    return {
      id: cart.id,
      revision: cart.revision,
      status: cart.status,
      currency: cart.currency,
      items,
      item: items[0] ?? null,
      proofApproved: items.length > 0 && items.every((item) => approvedItemIds.has(item.id)),
    };
  }

  async updateCartQuantity(
    session: ActiveSession,
    cartId: string,
    input: { itemId?: string; quantity: number; expectedRevision: number },
  ): Promise<CartView> {
    validateQuantity(input.quantity);
    await withTransaction(this.pool, async (client) => {
      const cartResult = await client.query<CartRow>(
        `SELECT c.id, c.revision, c.status, c.currency
         FROM app.carts c
         WHERE c.id = $1 AND ${cartOwnershipClause(2, 3)}
         FOR UPDATE`,
        [cartId, session.id, session.userId],
      );
      const cart = requireRow(cartResult.rows[0], 'Cart not found.');
      if (cart.status !== 'READY') {
        throw new CommerceValidationError('This cart can no longer be changed.');
      }
      if (cart.revision !== input.expectedRevision) {
        throw new CommerceValidationError('Your cart changed. Refresh it and try again.');
      }
      const targetItemId = input.itemId ?? (await this.firstCartItemId(client, cartId));
      const updatedItem = await client.query<{ id: string }>(
        `UPDATE app.cart_items SET quantity = $3, updated_at = now()
         WHERE cart_id = $1 AND id = $2 RETURNING id`,
        [cartId, targetItemId, input.quantity],
      );
      requireRow(updatedItem.rows[0], 'Cart has no items.');
      await client.query(
        `UPDATE app.carts SET revision = revision + 1, updated_at = now() WHERE id = $1`,
        [cartId],
      );
    });
    return this.getCart(session, cartId);
  }

  async removeCartItem(
    session: ActiveSession,
    cartId: string,
    input: number | { itemId?: string; expectedRevision: number },
  ): Promise<CartView> {
    const removal = typeof input === 'number' ? { expectedRevision: input } : input;
    await withTransaction(this.pool, async (client) => {
      const cartResult = await client.query<CartRow>(
        `SELECT c.id, c.revision, c.status, c.currency
         FROM app.carts c
         WHERE c.id = $1 AND ${cartOwnershipClause(2, 3)}
         FOR UPDATE`,
        [cartId, session.id, session.userId],
      );
      const cart = requireRow(cartResult.rows[0], 'Cart not found.');
      if (cart.status !== 'READY') {
        throw new CommerceValidationError('This cart can no longer be changed.');
      }
      if (cart.revision !== removal.expectedRevision) {
        throw new CommerceValidationError('Your cart changed. Refresh it and try again.');
      }
      const targetItemId = removal.itemId ?? (await this.firstCartItemId(client, cartId));
      const deleted = await client.query<{ id: string }>(
        'DELETE FROM app.cart_items WHERE cart_id = $1 AND id = $2 RETURNING id',
        [cartId, targetItemId],
      );
      requireRow(deleted.rows[0], 'Cart item not found.');
      const remaining = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM app.cart_items WHERE cart_id = $1',
        [cartId],
      );
      await client.query(
        `UPDATE app.carts
         SET status = $2, revision = revision + 1, updated_at = now()
         WHERE id = $1`,
        [cartId, Number(remaining.rows[0]?.count ?? '0') === 0 ? 'ABANDONED' : 'READY'],
      );
    });
    return this.getCart(session, cartId);
  }

  async approveProof(session: ActiveSession, cartId: string): Promise<void> {
    const items = await this.itemsForCart(session, cartId);
    for (const item of items) {
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
    await this.pool.query(
      `UPDATE app.carts SET revision = revision + 1, updated_at = now() WHERE id = $1`,
      [cartId],
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
         cart_id, recipient_name, email, phone, line1, line2, city, state_code, postal_code, country_code, save_to_account
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
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
        input.saveToAccount === true,
      ],
    );
    return requireRow(result.rows[0], 'Could not save your shipping address.').id;
  }

  async startCheckout(
    session: ActiveSession,
    cartId: string,
    input: CheckoutStartInput,
  ): Promise<CheckoutView> {
    if (!input.idempotencyKey || input.idempotencyKey.length < 12)
      throw new CommerceValidationError('A checkout idempotency key is required.');
    await this.pool.query(
      `UPDATE app.checkout_attempts attempt
       SET status = 'EXPIRED', updated_at = now()
       FROM app.carts c
       WHERE attempt.cart_id = c.id
         AND attempt.cart_id = $1
         AND attempt.status IN ('READY', 'PAYMENT_PENDING')
         AND attempt.price_expires_at <= now()
         AND ${cartOwnershipClause(2, 3)}`,
      [cartId, session.id, session.userId],
    );
    const existing = await this.pool.query<{ id: string }>(
      `SELECT ca.id FROM app.checkout_attempts ca JOIN app.carts c ON c.id = ca.cart_id
       WHERE ca.idempotency_key = $1 AND ${cartOwnershipClause(2, 3)}`,
      [input.idempotencyKey, session.id, session.userId],
    );
    if (existing.rows[0]) return this.getCheckout(session, existing.rows[0].id);
    const active = await this.pool.query<{ id: string }>(
      `SELECT ca.id FROM app.checkout_attempts ca JOIN app.carts c ON c.id = ca.cart_id
       WHERE ca.cart_id = $1 AND ca.status IN ('READY', 'PAYMENT_PENDING') AND ${cartOwnershipClause(2, 3)}
       ORDER BY ca.created_at DESC LIMIT 1`,
      [cartId, session.id, session.userId],
    );
    if (active.rows[0]) return this.getCheckout(session, active.rows[0].id);
    const items = await this.itemsForCart(session, cartId);
    const primaryItem = requireRow(items[0], 'Cart has no items.');
    for (const item of items) {
      await this.assertImmutableItemState(session, item);
      await this.assertProof(item);
    }
    const shippingAddress = await this.shippingAddress(session, cartId, input.shippingAddressId);
    const billingAddress = input.billingAddress
      ? normalizedBillingAddress(input.billingAddress)
      : billingAddressFromShipping(shippingAddress);
    const fulfillmentGroups = await this.provisionalGroups(items, shippingAddress.country_code);
    const providerShippingCents = fulfillmentGroups.reduce(
      (total, group) => total + group.quote.shippingCents,
      0,
    );
    const pricing = this.priceCart(items, providerShippingCents);
    const tax = await this.taxes.calculate({
      subtotalCents: pricing.subtotalCents,
      customerShippingCents: pricing.customerShippingCents,
      address: {
        countryCode: shippingAddress.country_code,
        stateCode: shippingAddress.state_code,
        postalCode: shippingAddress.postal_code,
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
    const expiry = fulfillmentQuoteExpiry(fulfillmentGroups, this.configuration.quoteTtlMinutes);
    const attemptId = randomUUID();
    const inserted = await withTransaction(this.pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO app.checkout_attempts (
           id, cart_id, shipping_address_id, status, idempotency_key, currency, amount_cents,
           billing_address_snapshot, pricing_snapshot, shipping_snapshot, tax_snapshot, payment_provider, price_expires_at
         ) VALUES ($1, $2, $3, 'PAYMENT_PENDING', $4, 'USD', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11) RETURNING id`,
        [
          attemptId,
          cartId,
          input.shippingAddressId,
          input.idempotencyKey,
          pricingWithTax.totalCents,
          JSON.stringify(billingAddress),
          JSON.stringify(pricingWithTax),
          JSON.stringify(
            toShippingSnapshot(fulfillmentGroups, pricingWithTax.customerShippingCents, expiry),
          ),
          JSON.stringify(taxSnapshot),
          this.paymentProvider(),
          expiry,
        ],
      );
      if (!result.rows[0]) return null;
      for (const group of fulfillmentGroups) {
        const persisted = await client.query<{ id: string }>(
          `INSERT INTO app.checkout_fulfillment_groups (
             checkout_attempt_id, group_key, adapter_type, provider_id, qualification_id, shipping_snapshot
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
          [
            attemptId,
            group.groupKey,
            group.adapterType,
            group.providerId,
            group.qualificationId,
            JSON.stringify(groupShippingSnapshot(group, expiry)),
          ],
        );
        const groupId = requireRow(persisted.rows[0], 'Could not save the fulfillment group.').id;
        for (const plannedItem of group.items) {
          await client.query(
            `INSERT INTO app.checkout_fulfillment_group_items (
               fulfillment_group_id, cart_item_id, item_snapshot
             ) VALUES ($1, $2, $3::jsonb)`,
            [groupId, plannedItem.item.id, JSON.stringify(fulfillmentItemSnapshot(plannedItem))],
          );
        }
      }
      return result.rows[0];
    });
    if (!inserted) return this.getCheckout(session, attemptId);
    let intent: PaymentIntentResult;
    try {
      intent = await this.payments.createIntent({
        checkoutAttemptId: attemptId,
        amountCents: pricingWithTax.totalCents,
        currency,
        idempotencyKey: input.idempotencyKey,
        customerEmail: shippingAddress.email,
        billingAddress,
      });
    } catch (error) {
      await this.pool.query(
        `UPDATE app.checkout_attempts
         SET status = 'PAYMENT_FAILED', updated_at = now()
         WHERE id = $1 AND status = 'PAYMENT_PENDING' AND provider_payment_id IS NULL`,
        [attemptId],
      );
      throw error;
    }
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
        primaryItem.project_id,
        JSON.stringify({
          productId: primaryItem.product_model_id,
          colorCode: primaryItem.color_code,
          size: primaryItem.size,
          itemCount: items.length,
          ...styleDimensions(primaryItem.product_snapshot),
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
    const result = await withTransaction(this.pool, async (client) =>
      this.persistPaymentEvent(client, event),
    );
    if (result.orderNumber && !result.duplicate && this.lifecycle) {
      const order = await this.pool.query<{
        id: string;
        customer_email: string;
        project_id: string;
      }>(
        `SELECT o.id, o.customer_email, i.project_id FROM app.orders o JOIN app.order_items i ON i.order_id = o.id WHERE o.order_number = $1`,
        [result.orderNumber],
      );
      const row = order.rows[0];
      if (row) {
        await this.lifecycle.suppressAbandonment({
          recipientEmail: row.customer_email,
          projectId: row.project_id,
          orderId: row.id,
        });
        await this.lifecycle.trigger({
          type: 'ORDER_CONFIRMATION',
          classification: 'TRANSACTIONAL',
          recipientEmail: row.customer_email,
          orderId: row.id,
          projectId: row.project_id,
          idempotencyKey: `order-confirmation:${row.id}`,
          payload: { orderNumber: result.orderNumber },
        });
      }
    }
    return result;
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
    // A verified provider event is financial evidence. A quote can expire while a
    // customer is completing a payment, but that must never discard a successful
    // charge or its audit trail. Quote expiry is enforced before creating/reusing
    // checkout intents; a late verified payment is finalized against its immutable
    // checkout snapshot and can be handled operationally from the resulting order.
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
    const created = await client.query<{
      order_number: string;
      customer_email: string;
      owner_user_id: string | null;
    }>(
      `INSERT INTO app.orders (
         order_number, cart_id, checkout_attempt_id, owner_type, owner_session_id, owner_user_id, customer_email,
         shipping_address_snapshot, billing_address_snapshot, status, pricing_snapshot, financial_snapshot
       ) SELECT $1, c.id, $2, c.owner_type, c.owner_session_id, c.owner_user_id, a.email,
                jsonb_build_object('recipientName', a.recipient_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city, 'stateCode', a.state_code, 'postalCode', a.postal_code, 'countryCode', a.country_code),
                checkout_attempt.billing_address_snapshot, 'PAID', $3::jsonb, $4::jsonb
         FROM app.carts c
         JOIN app.shipping_addresses a ON a.id = $5
         JOIN app.checkout_attempts checkout_attempt ON checkout_attempt.id = $2 AND checkout_attempt.cart_id = c.id
         WHERE c.id = $6 RETURNING order_number, customer_email, owner_user_id`,
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
    const createdOrder = requireRow(created.rows[0], 'Could not create paid order.');
    const orderNumberValue = createdOrder.order_number;
    await recordCustomerTouchpoint(client, {
      email: createdOrder.customer_email,
      source: 'ORDER',
      userId: createdOrder.owner_user_id,
    });
    await client.query(
      `INSERT INTO app.saved_addresses (
         user_id, recipient_name, line1, line2, city, state_code, postal_code, country_code, phone, is_default
       ) SELECT c.owner_user_id, a.recipient_name, a.line1, a.line2, a.city, a.state_code,
                a.postal_code, a.country_code, a.phone,
                NOT EXISTS (SELECT 1 FROM app.saved_addresses current WHERE current.user_id = c.owner_user_id)
         FROM app.carts c JOIN app.shipping_addresses a ON a.id = $1
         WHERE c.id = $2 AND c.owner_type = 'USER' AND c.owner_user_id IS NOT NULL
           AND a.save_to_account = true
           AND NOT EXISTS (
             SELECT 1 FROM app.saved_addresses existing
             WHERE existing.user_id = c.owner_user_id
               AND existing.line1 = a.line1 AND existing.city = a.city
               AND existing.state_code = a.state_code AND existing.postal_code = a.postal_code
           )`,
      [checkout.shipping_address_id, checkout.cart_id],
    );
    await client.query(
      `INSERT INTO app.order_items (order_id, cart_item_id, project_id, project_version_id, prepress_run_id, mockup_id, product_model_id, product_variant_id, quantity, item_snapshot)
       SELECT o.id, i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, i.product_model_id, i.product_variant_id, i.quantity, i.product_snapshot
       FROM app.orders o JOIN app.cart_items i ON i.cart_id = o.cart_id WHERE o.order_number = $1`,
      [orderNumberValue],
    );
    await client.query(
      `INSERT INTO app.order_fulfillment_groups (
         order_id, checkout_fulfillment_group_id, group_key, adapter_type, provider_id, qualification_id, shipping_snapshot
       )
       SELECT o.id, checkout_group.id, checkout_group.group_key, checkout_group.adapter_type,
              checkout_group.provider_id, checkout_group.qualification_id, checkout_group.shipping_snapshot
       FROM app.orders o
       JOIN app.checkout_fulfillment_groups checkout_group
         ON checkout_group.checkout_attempt_id = $1
       WHERE o.order_number = $2
       ON CONFLICT (order_id, group_key) DO NOTHING`,
      [checkout.id, orderNumberValue],
    );
    await client.query(
      `INSERT INTO app.order_fulfillment_group_items (fulfillment_group_id, order_item_id)
       SELECT fulfillment_group.id, order_item.id
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.checkout_fulfillment_groups checkout_group
         ON checkout_group.id = fulfillment_group.checkout_fulfillment_group_id
       JOIN app.checkout_fulfillment_group_items checkout_item
         ON checkout_item.fulfillment_group_id = checkout_group.id
       JOIN app.order_items order_item
         ON order_item.order_id = fulfillment_group.order_id
        AND order_item.cart_item_id = checkout_item.cart_item_id
       WHERE fulfillment_group.order_id = (
         SELECT id FROM app.orders WHERE order_number = $1
       )
       ON CONFLICT (order_item_id) DO NOTHING`,
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
    const mockup = await this.mockups.getOrCreate({
      projectId: source.project_id,
      projectVersionId: source.project_version_id,
      prepressRunId: source.prepress_run_id,
      prepressPreviewAssetId: source.preview_asset_id,
      productModelId: source.product_model_id,
      colorCode: source.selected_color_code,
    });
    return {
      id: mockup.id,
      preview_asset_id: mockup.previewAssetId,
      state_hash: mockup.stateHash,
    };
  }

  private async designPreviewAssetId(prepressRunId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT COALESCE(generated_preview.id, prepress_preview.id) AS id
       FROM app.prepress_runs run
       JOIN app.assets prepress_preview
         ON prepress_preview.id = run.preview_asset_id
        AND prepress_preview.asset_type = 'PREPRESS_PREVIEW'
        AND prepress_preview.status = 'ACTIVE'
       LEFT JOIN app.asset_lineage render_source
         ON render_source.derived_asset_id = run.production_master_asset_id
        AND render_source.relationship = 'PRODUCTION_RENDER_SOURCE'
       LEFT JOIN app.assets source ON source.id = render_source.source_asset_id
       LEFT JOIN app.assets generated_preview
         ON generated_preview.generation_id = source.generation_id
        AND generated_preview.asset_type = 'PREVIEW'
        AND generated_preview.status = 'ACTIVE'
       WHERE run.id = $1
       ORDER BY generated_preview.created_at DESC NULLS LAST
       LIMIT 1`,
      [prepressRunId],
    );
    return requireRow(result.rows[0], 'The artwork preview is unavailable.').id;
  }

  private async cart(session: ActiveSession, cartId: string): Promise<CartRow> {
    const result = await this.pool.query<CartRow>(
      `SELECT c.id, c.revision, c.status, c.currency FROM app.carts c WHERE c.id = $1 AND ${cartOwnershipClause(2, 3)}`,
      [cartId, session.id, session.userId],
    );
    return requireRow(result.rows[0], 'Cart not found.');
  }

  private async itemsForCart(session: ActiveSession, cartId: string): Promise<ItemRow[]> {
    await this.cart(session, cartId);
    const result = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.project_version_id, i.prepress_run_id, i.mockup_id, m.preview_asset_id,
              i.design_preview_asset_id,
              i.product_model_id,
              pm.display_name AS product_name, i.product_variant_id, i.color_code, v.color_name, i.size, i.quantity, v.price_cents AS unit_price_cents, i.product_snapshot
       FROM app.cart_items i JOIN app.mockups m ON m.id = i.mockup_id
       JOIN app.product_models pm ON pm.id = i.product_model_id JOIN app.product_variants v ON v.id = i.product_variant_id
       WHERE i.cart_id = $1 ORDER BY i.created_at`,
      [cartId],
    );
    if (!result.rows.length) throw new CommerceValidationError('Cart has no items.');
    return result.rows;
  }

  private async firstCartItemId(client: SqlClient, cartId: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM app.cart_items WHERE cart_id = $1 ORDER BY created_at LIMIT 1',
      [cartId],
    );
    return requireRow(result.rows[0], 'Cart has no items.').id;
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
    const currentMockup = await this.mockupFor(source);
    if (currentMockup.id !== item.mockup_id) {
      await this.pool.query(
        `UPDATE app.cart_items SET mockup_id = $2, updated_at = now() WHERE id = $1`,
        [item.id, currentMockup.id],
      );
      await this.pool.query(
        `UPDATE app.proof_approvals SET approval_state = 'INVALIDATED', invalidated_at = now(),
         invalidation_reason = 'The product proof profile changed.'
         WHERE cart_item_id = $1 AND approval_state = 'APPROVED'`,
        [item.id],
      );
      throw new CommerceValidationError(
        'Your product proof changed. Review and approve the updated proof before payment.',
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

  private async shippingAddress(
    session: ActiveSession,
    cartId: string,
    addressId: string,
  ): Promise<ShippingAddressRow> {
    await this.cart(session, cartId);
    const result = await this.pool.query<ShippingAddressRow>(
      `SELECT recipient_name, email, line1, line2, city, state_code, postal_code, country_code
       FROM app.shipping_addresses WHERE id = $1 AND cart_id = $2`,
      [addressId, cartId],
    );
    return requireRow(result.rows[0], 'Shipping address not found.');
  }

  private async provisionalGroups(
    items: ItemRow[],
    destinationCountry: string,
  ): Promise<FulfillmentGroupPlan[]> {
    const resolved = await Promise.all(
      items.map((item) => this.provisionalFulfillmentItem(item, destinationCountry)),
    );
    const groups = new Map<string, Omit<FulfillmentGroupPlan, 'quote'>>();
    for (const plannedItem of resolved) {
      const key = `${plannedItem.adapterType}:${plannedItem.providerId}:${plannedItem.qualificationId}:${destinationCountry}`;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(plannedItem.item);
        continue;
      }
      groups.set(key, {
        groupKey: key,
        adapterType: plannedItem.adapterType,
        providerId: plannedItem.providerId,
        qualificationId: plannedItem.qualificationId,
        externalProviderId: plannedItem.externalProviderId,
        items: [plannedItem.item],
      });
    }
    return Promise.all(
      [...groups.values()].map(async (group) => ({
        ...group,
        quote: await this.fulfillment.quoteShipping({
          externalProviderId: group.externalProviderId,
          destinationCountry,
          items: group.items.map((plannedItem) => ({
            externalBlueprintId: plannedItem.externalBlueprintId,
            externalVariantId: plannedItem.externalVariantId,
            quantity: plannedItem.item.quantity,
          })),
        }),
      })),
    );
  }

  private async provisionalFulfillmentItem(
    item: ItemRow,
    destinationCountry: string,
  ): Promise<{
    adapterType: 'PRINTIFY';
    providerId: string;
    qualificationId: string;
    externalProviderId: string;
    item: FulfillmentPlanItem;
  }> {
    const result = await this.pool.query<{
      adapter_type: 'PRINTIFY';
      provider_id: string;
      qualification_id: string;
      external_provider_id: string;
      external_blueprint_id: string;
      external_variant_id: string;
    }>(
      `SELECT pm.adapter_type, p.id AS provider_id, pq.id AS qualification_id,
              p.external_id AS external_provider_id, pm.external_blueprint_id, vm.external_variant_id
       FROM app.fulfillment_product_mappings pm
       JOIN app.fulfillment_variant_mappings vm ON vm.product_variant_id = $1 AND vm.adapter_type = pm.adapter_type
       JOIN app.print_providers p ON p.adapter_type = pm.adapter_type AND p.status = 'ENABLED'
       JOIN app.provider_qualifications pq ON pq.provider_id = p.id AND pq.product_model_id = pm.product_model_id
       WHERE pm.product_model_id = $2
         AND pq.active = true
         AND pq.shipping_enabled = true
         AND pq.destination_countries ? $3
         AND ($4::boolean = false OR p.development_only = true)
         AND ($5::text[] IS NULL OR p.external_id = ANY($5::text[]))
       ORDER BY p.id LIMIT 1`,
      [
        item.product_variant_id,
        item.product_model_id,
        destinationCountry,
        this.configuration.developmentProviderOnly ?? false,
        this.configuration.eligibleProviderExternalIds ?? null,
      ],
    );
    const mapping = requireRow(
      result.rows[0],
      `Shipping is unavailable for ${item.product_name} in ${destinationCountry}.`,
    );
    return {
      adapterType: mapping.adapter_type,
      providerId: mapping.provider_id,
      qualificationId: mapping.qualification_id,
      externalProviderId: mapping.external_provider_id,
      item: {
        item,
        externalBlueprintId: mapping.external_blueprint_id,
        externalVariantId: mapping.external_variant_id,
      },
    };
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

  private priceCart(items: ItemRow[], providerShippingCents: number): PricingSnapshot {
    const primaryItem = requireRow(items[0], 'Cart has no items.');
    const quantity = items.reduce((total, item) => total + item.quantity, 0);
    const gross = items.reduce((total, item) => total + item.unit_price_cents * item.quantity, 0);
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
      unitRetailCents: primaryItem.unit_price_cents,
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

function toCartLineView(item: ItemRow): CartLineView {
  return {
    id: item.id,
    projectId: item.project_id,
    projectVersionId: item.project_version_id,
    prepressRunId: item.prepress_run_id,
    mockupId: item.mockup_id,
    previewAssetId: item.preview_asset_id,
    designPreviewAssetId: item.design_preview_asset_id,
    productModelId: item.product_model_id,
    productName: item.product_name,
    variantId: item.product_variant_id,
    colorCode: item.color_code,
    colorName: item.color_name,
    size: item.size,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
  };
}

function validateAddress(address: ShippingAddressInput): void {
  if (
    address.email.trim().length > 254 ||
    !/^\S+@\S+\.\S+$/.test(address.email) ||
    !isValidPostalAddress(address) ||
    (address.phone !== undefined && address.phone !== null && !isValidPhone(address.phone))
  ) {
    throw new CommerceValidationError('Enter a complete US shipping address and a valid email.');
  }
}

function normalizedBillingAddress(address: BillingAddressInput): BillingAddress {
  if (!isValidPostalAddress(address))
    throw new CommerceValidationError('Enter a complete US billing address.');
  return {
    recipientName: address.recipientName.trim(),
    line1: address.line1.trim(),
    line2: address.line2?.trim() || null,
    city: address.city.trim(),
    stateCode: address.stateCode.trim().toUpperCase(),
    postalCode: address.postalCode.trim(),
    countryCode: address.countryCode.trim().toUpperCase(),
  };
}

function billingAddressFromShipping(address: ShippingAddressRow): BillingAddress {
  return {
    recipientName: address.recipient_name,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    stateCode: address.state_code,
    postalCode: address.postal_code,
    countryCode: address.country_code,
  };
}

function isValidPostalAddress(address: BillingAddressInput): boolean {
  const line1 = address.line1.trim();
  const line2 = address.line2?.trim() || null;
  const city = address.city.trim();
  return (
    Boolean(address.recipientName.trim()) &&
    address.recipientName.trim().length <= 80 &&
    Boolean(line1) &&
    line1.length <= 120 &&
    (!line2 || line2.length <= 120) &&
    Boolean(city) &&
    city.length <= 80 &&
    /^[A-Za-z]{2}$/.test(address.stateCode.trim()) &&
    /^\d{5}(?:-\d{4})?$/.test(address.postalCode.trim()) &&
    address.countryCode.trim().toUpperCase() === 'US'
  );
}

function isValidPhone(value: string): boolean {
  return /^[+0-9().\-\s]{7,25}$/.test(value.trim());
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
function fulfillmentQuoteExpiry(groups: FulfillmentGroupPlan[], quoteTtlMinutes: number): Date {
  const fallback = new Date(Date.now() + quoteTtlMinutes * 60_000);
  const expiries = groups
    .map((group) => group.quote.expiresAt)
    .filter((value): value is Date => Boolean(value && value > new Date()));
  return expiries.length
    ? new Date(Math.min(...expiries.map((value) => value.getTime())))
    : fallback;
}

function groupShippingSnapshot(
  group: FulfillmentGroupPlan,
  checkoutExpiry: Date,
): FulfillmentShippingGroupSnapshot {
  return {
    groupKey: group.groupKey,
    providerId: group.providerId,
    qualificationId: group.qualificationId,
    method: group.quote.method,
    shippingCents: group.quote.shippingCents,
    estimatedDeliveryMinDays: group.quote.estimatedDeliveryMinDays,
    estimatedDeliveryMaxDays: group.quote.estimatedDeliveryMaxDays,
    estimateKind: group.quote.estimateKind,
    expiresAt: (group.quote.expiresAt ?? checkoutExpiry).toISOString(),
  };
}

function fulfillmentItemSnapshot(item: FulfillmentPlanItem): Record<string, unknown> {
  return {
    projectId: item.item.project_id,
    productModelId: item.item.product_model_id,
    productVariantId: item.item.product_variant_id,
    externalBlueprintId: item.externalBlueprintId,
    externalVariantId: item.externalVariantId,
    quantity: item.item.quantity,
  };
}

function toShippingSnapshot(
  groups: FulfillmentGroupPlan[],
  customerShippingCents: number,
  expiresAt: Date,
): ShippingSnapshot {
  const snapshots = groups.map((group) => groupShippingSnapshot(group, expiresAt));
  return {
    method: snapshots.length === 1 ? snapshots[0]!.method : 'Multiple shipments',
    customerShippingCents,
    providerShippingCostCents: snapshots.reduce((total, group) => total + group.shippingCents, 0),
    currency,
    estimatedDeliveryMinDays: nullableMin(snapshots.map((group) => group.estimatedDeliveryMinDays)),
    estimatedDeliveryMaxDays: nullableMax(snapshots.map((group) => group.estimatedDeliveryMaxDays)),
    estimateKind:
      new Set(snapshots.map((group) => group.estimateKind)).size === 1
        ? snapshots[0]!.estimateKind
        : 'MULTIPLE',
    expiresAt: expiresAt.toISOString(),
    provisional: true,
    groups: snapshots,
  };
}

function nullableMin(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

function nullableMax(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.max(...present) : null;
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
