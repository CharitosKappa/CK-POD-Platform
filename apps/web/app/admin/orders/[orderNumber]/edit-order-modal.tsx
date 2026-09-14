'use client';

import React, { useId, useState } from 'react';
import type { EditOrderInput } from '@let-it-be/domain';
import { centsFromInput, formatOrderMoney } from './order-action-client';
import {
  ActionFeedback,
  ActionField,
  ActionFooter,
  OrderActionModal,
  useOrderAction,
  type OrderActionModalProps,
} from './order-action-modal';
import type { OrderDetail } from './order-detail-types';

export function editDraftFrom(order: OrderDetail) {
  return {
    email: order.customer.email,
    phone: order.customer.phone ?? '',
    note: '',
    reason: 'STAFF_EDIT',
    tags: order.tags.join(', '),
    discount: (order.financials.discountCents / 100).toFixed(2),
    shipping: (order.financials.shippingCents / 100).toFixed(2),
    address: { ...order.shippingAddress, line2: order.shippingAddress.line2 ?? '' },
    items: [
      ...new Map(
        order.groups.flatMap((group) => group.items).map((item) => [item.id, item]),
      ).values(),
    ].map((item) => ({
      orderItemId: item.id,
      productVariantId: item.productVariantId,
      quantity: String(item.quantity),
    })),
  };
}
type EditDraft = ReturnType<typeof editDraftFrom>;

export function buildEditPayload(
  order: OrderDetail,
  draft: EditDraft,
): Omit<EditOrderInput, 'orderNumber' | 'idempotencyKey'> {
  const original = editDraftFrom(order);
  const fields = order.eligibility.editFields;
  const result: Omit<EditOrderInput, 'orderNumber' | 'idempotencyKey'> = {
    reasonCode: draft.reason,
    note: draft.note,
  };
  if (fields.contact && draft.email !== original.email) result.customerEmail = draft.email;
  if (fields.contact && draft.phone !== original.phone) result.customerPhone = draft.phone;
  if (fields.notesAndTags && draft.tags !== original.tags)
    result.tags = [
      ...new Set(
        draft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
  if (fields.pricing && draft.discount !== original.discount)
    result.discountCents = centsFromInput(draft.discount);
  if (fields.pricing && draft.shipping !== original.shipping)
    result.shippingCents = centsFromInput(draft.shipping);
  if (fields.shippingAddress && JSON.stringify(draft.address) !== JSON.stringify(original.address))
    result.shippingAddress = { ...draft.address, email: draft.email, phone: draft.phone };
  if (fields.items && JSON.stringify(draft.items) !== JSON.stringify(original.items)) {
    if (!draft.items.length)
      throw new Error('Keep at least one item. Use Cancel order to cancel all items.');
    result.items = draft.items.map((item) => {
      const quantity = Number(item.quantity);
      if (!item.productVariantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        throw new Error('Select a variant and a quantity between 1 and 99 for every item.');
      return { orderItemId: item.orderItemId, productVariantId: item.productVariantId, quantity };
    });
  }
  return result;
}

export function EditOrderModal(props: OrderActionModalProps) {
  const action = useOrderAction(props, 'edit', 'edits');
  const [draft, setDraft] = useState(() => editDraftFrom(props.order));
  const form = useId();
  const fields = action.order.eligibility.editFields;
  const originalItems = new Map(
    action.order.groups.flatMap((group) => group.items).map((item) => [item.id, item]),
  );
  function change<K extends keyof EditDraft>(key: K, value: EditDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      void action.submit(buildEditPayload(action.order, draft));
    } catch (error) {
      action.setError(error instanceof Error ? error.message : 'Review the order fields.');
    }
  }
  return (
    <OrderActionModal
      title={`Edit order ${props.order.orderNumber}`}
      onClose={props.onClose}
      busy={action.busy}
      footer={
        <ActionFooter action={action} onClose={props.onClose} label="Save changes" form={form} />
      }
    >
      <p className="order-action-hint">
        Prices, shipping and tax are recalculated when saved. An increase creates an amount due and
        holds production; a decrease never issues a refund automatically.
      </p>
      <form id={form} onSubmit={submit}>
        <fieldset
          className="order-action-fields"
          disabled={action.busy || action.locked || !action.allowed}
        >
          <section className="order-edit-section">
            <h3>Items</h3>
            {!fields.items ? (
              <p className="order-field-locked">
                Items and variants are locked by the current production or fulfillment progress.
              </p>
            ) : null}
            <fieldset className="order-action-fields" disabled={!fields.items}>
              {draft.items.map((row, index) => {
                const item = originalItems.get(row.orderItemId);
                const options = item?.variantOptions ?? [];
                return (
                  <div className="order-edit-item" key={row.orderItemId}>
                    <strong>{item?.productName ?? 'Order item'}</strong>
                    <small>Current unit price: {formatOrderMoney(item?.unitPriceCents ?? 0)}</small>
                    <div className="customer-modal-grid">
                      <ActionField label="Variant">
                        <select
                          required
                          value={row.productVariantId}
                          onChange={(event) =>
                            change(
                              'items',
                              draft.items.map((entry, i) =>
                                i === index
                                  ? { ...entry, productVariantId: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        >
                          {!options.some((option) => option.id === row.productVariantId) ? (
                            <option value={row.productVariantId}>
                              {item?.color} · {item?.size} (current)
                            </option>
                          ) : null}
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.color} · {option.size}
                            </option>
                          ))}
                        </select>
                      </ActionField>
                      <ActionField label="Quantity">
                        <input
                          required
                          type="number"
                          min={1}
                          max={99}
                          step={1}
                          value={row.quantity}
                          onChange={(event) =>
                            change(
                              'items',
                              draft.items.map((entry, i) =>
                                i === index ? { ...entry, quantity: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                      </ActionField>
                    </div>
                    {draft.items.length > 1 ? (
                      <button
                        type="button"
                        className="order-action-link"
                        onClick={() =>
                          change(
                            'items',
                            draft.items.filter((entry) => entry.orderItemId !== row.orderItemId),
                          )
                        }
                      >
                        Remove item
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
          </section>
          <section className="order-edit-section">
            <h3>Pricing</h3>
            {!fields.pricing ? (
              <p className="order-field-locked">
                Prices are locked by the current production or fulfillment progress.
              </p>
            ) : null}
            <fieldset className="order-action-fields" disabled={!fields.pricing}>
              <div className="customer-modal-grid">
                <ActionField label="Discount (USD)">
                  <input
                    inputMode="decimal"
                    value={draft.discount}
                    onChange={(event) => change('discount', event.target.value)}
                  />
                </ActionField>
                <ActionField label="Shipping charge (USD)">
                  <input
                    inputMode="decimal"
                    value={draft.shipping}
                    onChange={(event) => change('shipping', event.target.value)}
                  />
                </ActionField>
              </div>
            </fieldset>
          </section>
          <section className="order-edit-section">
            <h3>Contact</h3>
            <fieldset className="order-action-fields" disabled={!fields.contact}>
              <div className="customer-modal-grid">
                <ActionField label="Customer email">
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={draft.email}
                    onChange={(event) => change('email', event.target.value)}
                  />
                </ActionField>
                <ActionField label="Phone">
                  <input
                    type="tel"
                    maxLength={25}
                    value={draft.phone}
                    onChange={(event) => change('phone', event.target.value)}
                  />
                </ActionField>
              </div>
            </fieldset>
          </section>
          <section className="order-edit-section">
            <h3>Shipping address</h3>
            {!fields.shippingAddress ? (
              <p className="order-field-locked">
                Shipping address is locked by the current production or fulfillment progress.
              </p>
            ) : null}
            <fieldset className="order-action-fields" disabled={!fields.shippingAddress}>
              <div className="customer-modal-grid">
                {(
                  [
                    ['recipientName', 'Recipient'],
                    ['line1', 'Street address'],
                    ['line2', 'Apartment, suite, etc.'],
                    ['city', 'City'],
                    ['stateCode', 'State'],
                    ['postalCode', 'ZIP / postal code'],
                    ['countryCode', 'Country code'],
                  ] as const
                ).map(([key, label]) => (
                  <ActionField
                    key={key}
                    label={label}
                    full={key === 'recipientName' || key === 'line1' || key === 'line2'}
                  >
                    <input
                      required={key !== 'line2'}
                      maxLength={key === 'countryCode' ? 2 : 200}
                      value={draft.address[key]}
                      onChange={(event) =>
                        change('address', {
                          ...draft.address,
                          [key]:
                            key === 'countryCode'
                              ? event.target.value.toUpperCase()
                              : event.target.value,
                        })
                      }
                    />
                  </ActionField>
                ))}
              </div>
            </fieldset>
          </section>
          <section className="order-edit-section">
            <h3>Internal details</h3>
            <fieldset className="order-action-fields" disabled={!fields.notesAndTags}>
              <div className="customer-modal-grid">
                <ActionField label="Tags" full>
                  <input
                    value={draft.tags}
                    onChange={(event) => change('tags', event.target.value)}
                  />
                  <small>Separate tags with commas.</small>
                </ActionField>
                <ActionField label="Reason" full>
                  <select
                    value={draft.reason}
                    onChange={(event) => change('reason', event.target.value)}
                  >
                    <option value="STAFF_EDIT">Staff correction</option>
                    <option value="CUSTOMER_REQUEST">Customer request</option>
                  </select>
                </ActionField>
                <ActionField label="Staff note" full>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={draft.note}
                    onChange={(event) => change('note', event.target.value)}
                  />
                </ActionField>
              </div>
            </fieldset>
          </section>
        </fieldset>
      </form>
      <ActionFeedback outcome={action.outcome} error={action.error} />
    </OrderActionModal>
  );
}
