import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { formatOrderAddress } from './order-detail-format';
import type { OrderDetail } from './order-detail-types';

export function OrderDetailSidebar({
  order,
  busy,
  onAddNote,
  onSaveTags,
}: Readonly<{
  order: OrderDetail;
  busy: string | undefined;
  onAddNote: (body: string) => Promise<boolean>;
  onSaveTags: (tags: string[]) => Promise<boolean>;
}>) {
  const [note, setNote] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState(order.tags.join(', '));

  useEffect(() => setTagDraft(order.tags.join(', ')), [order.tags]);

  const submitNote = async () => {
    if (await onAddNote(note)) setNote('');
  };

  const submitTags = async () => {
    const tags = tagDraft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (await onSaveTags(tags)) setEditingTags(false);
  };

  return (
    <aside className="order-detail-sidebar">
      <article className="order-detail-card order-notes-card">
        <header className="order-side-header">
          <h2>Notes</h2>
        </header>
        {order.eligibility.editFields.notesAndTags ? (
          <div className="order-note-composer">
            <label htmlFor="order-note">Add an internal note</label>
            <textarea
              id="order-note"
              value={note}
              maxLength={5000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Only staff can see this note"
            />
            <button
              type="button"
              disabled={!note.trim() || Boolean(busy)}
              onClick={() => void submitNote()}
            >
              {busy === 'note' ? 'Adding…' : 'Add note'}
            </button>
          </div>
        ) : null}
        {order.notes.length ? (
          <div className="order-latest-note">
            <p>{order.notes[0]!.body}</p>
            <small>
              {order.notes[0]!.createdByName} ·{' '}
              {new Date(order.notes[0]!.createdAt).toLocaleString('en-US')}
            </small>
          </div>
        ) : (
          <p className="order-empty-copy">No notes from staff.</p>
        )}
      </article>

      <article className="order-detail-card order-customer-card">
        <header className="order-side-header">
          <h2>Customer</h2>
        </header>
        <div className="order-side-section">
          {order.customer.id ? (
            <Link href={`/admin/customers/${order.customer.id}`}>{order.customer.name}</Link>
          ) : (
            <strong>{order.customer.name}</strong>
          )}
          <span>
            {order.customer.orderCount} order{order.customer.orderCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="order-side-section">
          <h3>Contact information</h3>
          <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
          <span>{order.customer.phone ?? 'No phone number'}</span>
        </div>
        <AddressBlock title="Shipping address" lines={formatOrderAddress(order.shippingAddress)} />
        <AddressBlock
          title="Billing address"
          lines={formatOrderAddress(order.billingAddress)}
          {...(order.billingMatchesShipping ? { hint: 'Same as shipping address' } : {})}
        />
      </article>

      <article className="order-detail-card order-tags-card">
        <header className="order-side-header">
          <h2>Tags</h2>
          {order.eligibility.editFields.notesAndTags ? (
            <button
              type="button"
              onClick={() => setEditingTags((value) => !value)}
              aria-label="Edit order tags"
            >
              {editingTags ? 'Close' : 'Edit'}
            </button>
          ) : null}
        </header>
        {editingTags && order.eligibility.editFields.notesAndTags ? (
          <div className="order-tag-editor">
            <label htmlFor="order-tags">Comma-separated tags</label>
            <textarea
              id="order-tags"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              maxLength={4096}
            />
            <button type="button" disabled={Boolean(busy)} onClick={() => void submitTags()}>
              {busy === 'tags' ? 'Saving…' : 'Save tags'}
            </button>
          </div>
        ) : order.tags.length ? (
          <div className="order-tag-list">
            {order.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : (
          <p className="order-empty-copy">No tags</p>
        )}
      </article>
    </aside>
  );
}

function AddressBlock({
  title,
  lines,
  hint,
}: Readonly<{ title: string; lines: string[]; hint?: string }>) {
  return (
    <div className="order-side-section">
      <h3>{title}</h3>
      {hint ? (
        <span>{hint}</span>
      ) : (
        <address>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </address>
      )}
    </div>
  );
}
