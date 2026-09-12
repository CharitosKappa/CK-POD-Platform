'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { CustomerDetail } from './customer-types';

export type CustomerSidebarAction =
  'customer' | 'address' | 'marketing' | 'tags' | 'note' | 'storeCredit' | 'storeCreditLedger';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function CustomerDetailSidebar({
  customer,
  onAction,
}: Readonly<{
  customer: CustomerDetail;
  onAction: (action: CustomerSidebarAction) => void;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const address = customer.addresses.find((entry) => entry.isDefault) ?? customer.addresses[0];
  const latestNote = customer.timeline.find(
    (entry) => (entry.eventType === 'NOTE' || entry.eventType === 'LEGACY_NOTE') && entry.body,
  )?.body;

  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent) {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [menuOpen]);

  function choose(action: CustomerSidebarAction) {
    setMenuOpen(false);
    onAction(action);
  }

  return (
    <aside className="customer-detail-side" aria-label="Customer details">
      <section className="customer-card customer-sidebar-card customer-contact-card">
        <header className="customer-sidebar-card-header">
          <h2>Contact information</h2>
          <div className="customer-sidebar-menu-root" ref={menuRoot}>
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Customer information actions"
              className="customer-sidebar-icon-button customer-sidebar-more-button"
              onClick={() => setMenuOpen((current) => !current)}
              type="button"
            >
              <span aria-hidden="true">•••</span>
            </button>
            {menuOpen ? (
              <div className="customer-sidebar-action-menu" role="menu">
                <button onClick={() => choose('customer')} role="menuitem" type="button">
                  Edit contact information
                </button>
                <button onClick={() => choose('address')} role="menuitem" type="button">
                  Manage addresses
                </button>
                <button onClick={() => choose('marketing')} role="menuitem" type="button">
                  Edit marketing settings
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="customer-contact-card-body">
          <div className="customer-contact-links">
            <a href={`mailto:${customer.email}`}>{customer.email}</a>
            {customer.phone ? (
              <a href={`tel:${customer.phone}`}>{customer.phone}</a>
            ) : (
              <span>Not provided</span>
            )}
          </div>
          <p className="customer-notification-language customer-sidebar-copy">
            Will receive notifications in {languageName(customer.preferredLocale)}
          </p>

          <SidebarSection title="Default address">
            {address ? (
              <address className="customer-sidebar-address">
                <span>{address.recipientName}</span>
                <span>{address.line1}</span>
                {address.line2 ? <span>{address.line2}</span> : null}
                <span>{[address.postalCode, address.city].filter(Boolean).join(' ')}</span>
                {address.stateCode ? <span>{address.stateCode}</span> : null}
                <span>{regionName(address.countryCode)}</span>
                {address.phone ? <span>{address.phone}</span> : null}
              </address>
            ) : (
              <p className="customer-sidebar-empty customer-sidebar-copy">No address saved.</p>
            )}
          </SidebarSection>

          <SidebarSection title="Marketing subscriptions">
            <p className="customer-sidebar-copy">{marketingSubscriptions(customer)}</p>
          </SidebarSection>

          <SidebarSection title="Tax details">
            <p className="customer-sidebar-copy">VAT number: Not provided</p>
            <p className="customer-sidebar-copy">Collect tax</p>
          </SidebarSection>
        </div>
      </section>

      <section className="customer-card customer-sidebar-card">
        <header className="customer-sidebar-card-header">
          <h2>Design credits</h2>
        </header>
        <p className="customer-sidebar-card-value">
          {customer.creditBalance} design credit{customer.creditBalance === 1 ? '' : 's'}
        </p>
      </section>

      <section className="customer-card customer-sidebar-card">
        <header className="customer-sidebar-card-header">
          <h2>Store credit</h2>
          <IconButton
            label="Adjust store credit"
            onClick={() => choose('storeCredit')}
            type="edit"
          />
        </header>
        <div className="customer-store-credit-card-row">
          <p className="customer-sidebar-card-value">
            {customer.storeCreditTransactionCount
              ? `${usd.format(customer.storeCreditBalanceCents / 100)} USD`
              : '-'}
          </p>
          {customer.storeCreditTransactionCount ? (
            <button
              aria-label="View store credit activity"
              className="customer-store-credit-ledger-button"
              onClick={() => choose('storeCreditLedger')}
              type="button"
            >
              <ChevronRightIcon />
            </button>
          ) : null}
        </div>
      </section>

      <section className="customer-card customer-sidebar-card customer-sidebar-tags-card">
        <header className="customer-sidebar-card-header">
          <h2>Tags</h2>
          <IconButton label="Edit customer tags" onClick={() => choose('tags')} type="add" />
        </header>
        <div className="customer-sidebar-tags-field" aria-label="Customer tags">
          {customer.tags.length ? (
            customer.tags.map((tag) => <span key={tag}>{tag}</span>)
          ) : (
            <span className="customer-sidebar-empty">None</span>
          )}
        </div>
      </section>

      <section className="customer-card customer-sidebar-card">
        <header className="customer-sidebar-card-header">
          <h2>Notes</h2>
          <IconButton label="Add customer note" onClick={() => choose('note')} type="edit" />
        </header>
        <p className="customer-sidebar-card-value">{latestNote ?? 'None'}</p>
      </section>
    </aside>
  );
}

function SidebarSection({
  children,
  title,
}: Readonly<{ children: React.ReactNode; title: string }>) {
  return (
    <section className="customer-sidebar-subsection">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  type,
}: Readonly<{
  label: string;
  onClick?: () => void;
  type: 'add' | 'edit';
}>) {
  return (
    <button
      aria-label={label}
      className="customer-sidebar-icon-button"
      onClick={onClick}
      type="button"
    >
      {type === 'add' ? <AddIcon /> : <EditIcon />}
    </button>
  );
}

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.5v7M6.5 10h7" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m5.1 13.9.7-3.1 6.8-6.8a1.4 1.4 0 0 1 2 0l1.4 1.4a1.4 1.4 0 0 1 0 2l-6.8 6.8-3.1.7a.85.85 0 0 1-1-.99Z" />
      <path d="m11.6 5 3.4 3.4" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

function marketingSubscriptions(customer: CustomerDetail) {
  const subscriptions = [
    customer.emailMarketingStatus === 'SUBSCRIBED' ? 'Email' : null,
    customer.smsMarketingStatus === 'SUBSCRIBED' ? 'SMS' : null,
  ].filter(Boolean);
  return subscriptions.join(', ') || 'None';
}

function regionName(countryCode: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function languageName(locale: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export function filterTagOptions(catalog: string[], selectedTags: string[], query: string) {
  const normalizedQuery = query.trim();
  const queryKey = normalizedQuery.toLocaleLowerCase();
  const selected = uniqueTags(selectedTags);
  const selectedKeys = new Set(selected.map((tag) => tag.toLocaleLowerCase()));
  const knownTags = uniqueTags([...catalog, ...selected]).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' }),
  );
  const matches = (tag: string) => !queryKey || tag.toLocaleLowerCase().includes(queryKey);

  return {
    selected: selected.filter(matches),
    available: knownTags.filter(
      (tag) => !selectedKeys.has(tag.toLocaleLowerCase()) && matches(tag),
    ),
    addable:
      normalizedQuery && !knownTags.some((tag) => tag.toLocaleLowerCase() === queryKey)
        ? normalizedQuery
        : null,
  };
}

function uniqueTags(tags: string[]) {
  const unique = new Map<string, string>();
  for (const value of tags) {
    const tag = value.trim();
    if (tag && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag);
  }
  return [...unique.values()];
}
