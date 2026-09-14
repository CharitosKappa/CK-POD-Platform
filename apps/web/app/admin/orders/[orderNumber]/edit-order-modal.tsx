'use client';

import React, { useId, useRef, useState } from 'react';
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

interface EditDraftItem {
  draftKey: string;
  orderItemId?: string;
  sourceOrderItemId?: string;
  productVariantId: string;
  quantity: string;
}

interface EditDraft {
  email: string;
  phone: string;
  note: string;
  reason: string;
  tags: string;
  discount: string;
  shipping: string;
  address: OrderDetail['shippingAddress'] & { line2: string };
  items: EditDraftItem[];
}

export function editDraftFrom(order: OrderDetail): EditDraft {
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
    ].map((item): EditDraftItem => ({
      draftKey: item.id,
      orderItemId: item.id,
      productVariantId: item.productVariantId,
      quantity: String(item.quantity),
    })),
  };
}

export function addItemWithDesign(
  draft: EditDraft,
  source: OrderDetail['groups'][number]['items'][number],
): EditDraft {
  const ordinal = draft.items.filter((item) => item.sourceOrderItemId === source.id).length + 1;
  const added: EditDraftItem = {
    draftKey: `new:${source.id}:${ordinal}`,
    sourceOrderItemId: source.id,
    productVariantId: source.productVariantId,
    quantity: '1',
  };
  return { ...draft, items: [...draft.items, added] };
}

/** The local draft never absorbs refreshed data. Only values changed from its
 * original baseline overlay the latest server snapshot shown in the form. */
export function rebaseEditDraft(
  baseline: OrderDetail,
  local: EditDraft,
  current: OrderDetail,
): EditDraft {
  const original = editDraftFrom(baseline);
  const next = editDraftFrom(current);
  for (const key of ['email', 'phone', 'note', 'reason', 'tags', 'discount', 'shipping'] as const) {
    if (local[key] !== original[key]) next[key] = local[key];
  }
  for (const key of Object.keys(original.address) as Array<keyof EditDraft['address']>) {
    if (local.address[key] !== original.address[key]) next.address[key] = local.address[key];
  }
  const originals = new Map(original.items.map((item) => [item.orderItemId, item]));
  const edits = new Map(
    local.items.filter((item) => item.orderItemId).map((item) => [item.orderItemId!, item]),
  );
  const rebasedExisting = next.items
    .filter(
      (item) =>
        item.orderItemId !== undefined &&
        (!originals.has(item.orderItemId) || edits.has(item.orderItemId)),
    )
    .map((item) => {
      const before = originals.get(item.orderItemId!),
        edited = edits.get(item.orderItemId!);
      if (!before || !edited) return item;
      return {
        ...item,
        ...(edited.quantity !== before.quantity ? { quantity: edited.quantity } : {}),
        ...(edited.productVariantId !== before.productVariantId
          ? { productVariantId: edited.productVariantId }
          : {}),
      };
    });
  const currentIds = new Set(next.items.map((item) => item.orderItemId));
  const added = local.items.filter(
    (item) => item.sourceOrderItemId && currentIds.has(item.sourceOrderItemId),
  );
  next.items = [...rebasedExisting, ...added];
  return next;
}

export function buildEditPayload(
  order: OrderDetail,
  draft: EditDraft,
  baseline: OrderDetail = order,
): Omit<EditOrderInput, 'orderNumber' | 'idempotencyKey'> {
  const original = editDraftFrom(baseline);
  const merged = rebaseEditDraft(baseline, draft, order);
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
    result.shippingAddress = { ...merged.address, email: merged.email, phone: merged.phone };
  if (fields.items && JSON.stringify(draft.items) !== JSON.stringify(original.items)) {
    const currentIds = new Set(order.groups.flatMap((group) => group.items).map((item) => item.id));
    if (
      draft.items.some(
        (item) =>
          item.orderItemId !== undefined &&
          !currentIds.has(item.orderItemId) &&
          JSON.stringify(item) !==
            JSON.stringify(
              original.items.find((before) => before.orderItemId === item.orderItemId),
            ),
      )
    )
      throw new Error(
        'An item you edited is no longer on this order. Close and reopen Edit to review the current items.',
      );
    if (!merged.items.length)
      throw new Error('Keep at least one item. Use Cancel order to cancel all items.');
    result.items = merged.items.map((item): NonNullable<EditOrderInput['items']>[number] => {
      const quantity = Number(item.quantity);
      if (!item.productVariantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        throw new Error('Select a variant and a quantity between 1 and 99 for every item.');
      if ((item.orderItemId === undefined) === (item.sourceOrderItemId === undefined))
        throw new Error('Select exactly one design source for every item.');
      return item.orderItemId
        ? { orderItemId: item.orderItemId, productVariantId: item.productVariantId, quantity }
        : {
            sourceOrderItemId: item.sourceOrderItemId!,
            productVariantId: item.productVariantId,
            quantity,
          };
    });
  }
  return result;
}

export function EditOrderModal(props: OrderActionModalProps) {
  const action = useOrderAction(props, 'edit', 'edits');
  const baseline = useRef(props.order).current;
  const [localDraft, setDraft] = useState(() => editDraftFrom(baseline));
  const draft = rebaseEditDraft(baseline, localDraft, action.order);
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
      void action.submit(buildEditPayload(action.order, localDraft, baseline));
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
              {draft.items.map((row) => {
                const sourceId = row.orderItemId ?? row.sourceOrderItemId;
                const item = sourceId ? originalItems.get(sourceId) : undefined;
                const options = item?.variantOptions ?? [];
                const selectedPrice =
                  options.find((option) => option.id === row.productVariantId)?.unitPriceCents ??
                  item?.unitPriceCents ??
                  0;
                return (
                  <div className="order-edit-item" key={row.draftKey}>
                    <strong>{item?.productName ?? 'Order item'}</strong>
                    <small>Server price: {formatOrderMoney(selectedPrice)}</small>
                    <div className="customer-modal-grid">
                      <ActionField label="Variant">
                        <select
                          required
                          disabled={
                            !localDraft.items.some((item) => item.draftKey === row.draftKey)
                          }
                          value={row.productVariantId}
                          onChange={(event) =>
                            change(
                              'items',
                              localDraft.items.map((entry) =>
                                entry.draftKey === row.draftKey
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
                          disabled={
                            !localDraft.items.some((item) => item.draftKey === row.draftKey)
                          }
                          type="number"
                          min={1}
                          max={99}
                          step={1}
                          value={row.quantity}
                          onChange={(event) =>
                            change(
                              'items',
                              localDraft.items.map((entry) =>
                                entry.draftKey === row.draftKey
                                  ? { ...entry, quantity: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </ActionField>
                    </div>
                    {draft.items.length > 1 &&
                    localDraft.items.some((item) => item.draftKey === row.draftKey) ? (
                      <button
                        type="button"
                        className="order-action-link"
                        onClick={() =>
                          change(
                            'items',
                            localDraft.items.filter((entry) => entry.draftKey !== row.draftKey),
                          )
                        }
                      >
                        Remove item
                      </button>
                    ) : null}
                    {!localDraft.items.some((item) => item.draftKey === row.draftKey) ? (
                      <small>
                        This item was added while you were editing. Reopen Edit to change it.
                      </small>
                    ) : null}
                  </div>
                );
              })}
              {[
                ...new Map(
                  action.order.groups
                    .flatMap((group) => group.items)
                    .map((item) => [item.id, item]),
                ).values(),
              ].map((item) => (
                <button
                  type="button"
                  className="order-action-link"
                  key={`add-${item.id}`}
                  onClick={() => setDraft((current) => addItemWithDesign(current, item))}
                >
                  Add another item with this design
                </button>
              ))}
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
                          ...localDraft.address,
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
