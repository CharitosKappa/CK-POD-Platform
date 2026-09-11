'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type View = 'overview' | 'personal' | 'addresses' | 'designs' | 'credits' | 'orders';

interface Profile {
  email: string;
  firstName: string;
  lastName: string;
  revision: number;
}

interface Address {
  id: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
  revision: number;
}

interface Design {
  projectId: string;
  prompt: string;
  generationId: string | null;
  previewAssetId: string | null;
  updatedAt: string;
}

interface Credits {
  balance: number;
  entries: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
}

interface Order {
  orderNumber: string;
  status: string;
  itemCount: number;
  totalCents: number;
  createdAt: string;
}

const emptyAddress = {
  recipientName: '',
  line1: '',
  line2: '',
  city: '',
  stateCode: 'FL',
  postalCode: '',
  countryCode: 'US',
  phone: '',
  isDefault: false,
};

export function AccountScreen({ view }: { view: View }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addressDraft, setAddressDraft] = useState(emptyAddress);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch((reason: unknown) => {
        if (active) setError(messageFor(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);

  const heading = {
    overview: 'My account',
    personal: 'Personal details',
    addresses: 'Addresses',
    designs: 'Saved designs',
    credits: 'Design credits',
    orders: 'Orders',
  }[view];
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const defaultAddress = addresses.find((address) => address.isDefault) ?? addresses[0];
  const profileReady = Boolean(profile?.firstName && profile?.lastName);
  const addressForm = editingAddress
    ? {
        recipientName: editingAddress.recipientName,
        line1: editingAddress.line1,
        line2: editingAddress.line2 ?? '',
        city: editingAddress.city,
        stateCode: editingAddress.stateCode,
        postalCode: editingAddress.postalCode,
        countryCode: editingAddress.countryCode,
        phone: editingAddress.phone ?? '',
        isDefault: editingAddress.isDefault,
      }
    : addressDraft;

  return (
    <main className="account-production-page">
      <header className="account-production-header">
        <Link
          aria-label="Back"
          className="account-production-back"
          href={view === 'overview' ? '/' : '/account'}
        >
          ←
        </Link>
        <strong>LET IT BE</strong>
        <span aria-hidden="true" />
      </header>
      <section className="account-production-content" aria-labelledby="account-heading">
        <p className="account-production-kicker">{heading}</p>
        {loading ? <p className="account-production-loading">Loading your account…</p> : null}
        {error ? (
          <p className="account-production-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="account-production-feedback" role="status">
            {notice}
          </p>
        ) : null}
        {!loading && view === 'overview' ? (
          <>
            <h1 id="account-heading">
              {profileReady ? `Hi, ${profile?.firstName}.` : 'Make it yours.'}
            </h1>
            <p className="account-production-email">{profile?.email}</p>
            <AccountSection title="Personal & addresses" action="Edit" href="/account/personal">
              <Link className="account-production-card" href="/account/personal">
                <b>{displayName || 'Add your name'}</b>
                <span>
                  {defaultAddress ? addressLine(defaultAddress) : 'Add a delivery address'}{' '}
                  <em>›</em>
                </span>
              </Link>
            </AccountSection>
            <AccountSection title="Saved designs" action="View all" href="/account/designs">
              {designs.length ? (
                <div className="account-production-design-grid">
                  {designs.slice(0, 2).map((design) => (
                    <DesignCard design={design} key={design.projectId} />
                  ))}
                </div>
              ) : (
                <Empty text="Your completed designs will appear here." />
              )}
            </AccountSection>
            <AccountSection title="Design credits" action="View history" href="/account/credits">
              <Link className="account-production-credit-card" href="/account/credits">
                <span>Available to create</span>
                <b>{credits?.balance ?? 0} credits</b>
                <small>
                  {credits?.entries[0]
                    ? ledgerLabel(credits.entries[0])
                    : 'Your credit history will appear here.'}
                </small>
              </Link>
            </AccountSection>
            <AccountSection title="Orders" action="View all" href="/account/orders">
              {orders[0] ? (
                <OrderRow order={orders[0]} />
              ) : (
                <Empty text="Your orders will appear here after checkout." />
              )}
            </AccountSection>
          </>
        ) : null}
        {!loading && view === 'personal' && profile ? (
          <form className="account-production-form" onSubmit={(event) => void saveProfile(event)}>
            <h1 id="account-heading">Your details.</h1>
            <label htmlFor="account-first-name">First name</label>
            <input
              id="account-first-name"
              onChange={(event) => setFirstName(event.target.value)}
              value={firstName}
            />
            <label htmlFor="account-last-name">Last name</label>
            <input
              id="account-last-name"
              onChange={(event) => setLastName(event.target.value)}
              value={lastName}
            />
            <label htmlFor="account-email">Email</label>
            <input id="account-email" readOnly value={profile.email} />
            <button className="account-production-primary" disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save changes'} <span>→</span>
            </button>
            <Link className="account-production-text-action" href="/account/addresses">
              Manage addresses
            </Link>
          </form>
        ) : null}
        {!loading && view === 'addresses' ? (
          <section className="account-production-addresses">
            <h1 id="account-heading">Your addresses.</h1>
            {addresses.map((address) => (
              <article className="account-production-address-card" key={address.id}>
                <b>{address.isDefault ? 'Default delivery address' : 'Saved address'}</b>
                <span>
                  {address.recipientName}
                  <br />
                  {addressLine(address)}
                </span>
                <div>
                  <button onClick={() => beginEdit(address)} type="button">
                    Edit
                  </button>
                  <button onClick={() => void removeAddress(address)} type="button">
                    Remove
                  </button>
                </div>
              </article>
            ))}
            <form
              className="account-production-form account-production-address-form"
              onSubmit={(event) => void saveAddress(event)}
            >
              <h2>{editingAddress ? 'Edit address' : 'Add an address'}</h2>
              <label htmlFor="recipient-name">Full name</label>
              <input
                id="recipient-name"
                onChange={(event) => changeAddress('recipientName', event.target.value)}
                value={addressForm.recipientName}
              />
              <label htmlFor="address-line1">Address</label>
              <input
                id="address-line1"
                onChange={(event) => changeAddress('line1', event.target.value)}
                value={addressForm.line1}
              />
              <label htmlFor="address-line2">
                Apartment, suite, etc. <small>Optional</small>
              </label>
              <input
                id="address-line2"
                onChange={(event) => changeAddress('line2', event.target.value)}
                value={addressForm.line2}
              />
              <div className="account-production-field-row">
                <label htmlFor="address-city">
                  City
                  <input
                    id="address-city"
                    onChange={(event) => changeAddress('city', event.target.value)}
                    value={addressForm.city}
                  />
                </label>
                <label htmlFor="address-state">
                  State
                  <input
                    id="address-state"
                    maxLength={2}
                    onChange={(event) =>
                      changeAddress('stateCode', event.target.value.toUpperCase())
                    }
                    value={addressForm.stateCode}
                  />
                </label>
              </div>
              <label htmlFor="address-postal">ZIP code</label>
              <input
                id="address-postal"
                inputMode="numeric"
                onChange={(event) => changeAddress('postalCode', event.target.value)}
                value={addressForm.postalCode}
              />
              <label className="account-production-check">
                <input
                  checked={addressForm.isDefault}
                  onChange={(event) => changeAddress('isDefault', event.target.checked)}
                  type="checkbox"
                />{' '}
                Use as default delivery address
              </label>
              <button className="account-production-primary" disabled={saving} type="submit">
                {saving ? 'Saving…' : editingAddress ? 'Save address' : 'Add address'}{' '}
                <span>→</span>
              </button>
              {editingAddress ? (
                <button
                  className="account-production-text-button"
                  onClick={cancelEdit}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </form>
          </section>
        ) : null}
        {!loading && view === 'designs' ? (
          <section className="account-production-list">
            <h1 id="account-heading">Your designs.</h1>
            {designs.length ? (
              designs.map((design) => <DesignRow design={design} key={design.projectId} />)
            ) : (
              <Empty text="Finish a design and it will be saved here." />
            )}
          </section>
        ) : null}
        {!loading && view === 'credits' ? (
          <section className="account-production-list">
            <h1 id="account-heading">{credits?.balance ?? 0} design credits.</h1>
            <p className="account-production-intro">
              Credits are used when you create a new design.
            </p>
            <h2>History</h2>
            {credits?.entries.length ? (
              credits.entries.map((entry) => <LedgerRow entry={entry} key={entry.id} />)
            ) : (
              <Empty text="No credit activity yet." />
            )}
          </section>
        ) : null}
        {!loading && view === 'orders' ? (
          <section className="account-production-list">
            <h1 id="account-heading">Your orders.</h1>
            {orders.length ? (
              orders.map((order) => <OrderRow key={order.orderNumber} order={order} />)
            ) : (
              <Empty text="Your orders will appear here after checkout." />
            )}
          </section>
        ) : null}
      </section>
    </main>
  );

  async function load(): Promise<void> {
    setLoading(true);
    setError('');
    const targets =
      view === 'overview'
        ? ['profile', 'addresses', 'designs', 'credits', 'orders']
        : view === 'personal'
          ? ['profile']
          : view === 'addresses'
            ? ['addresses']
            : [view];
    const responses = await Promise.all(targets.map((target) => request(`/api/account/${target}`)));
    const byTarget = Object.fromEntries(
      targets.map((target, index) => [target, responses[index]]),
    ) as Record<string, unknown>;
    if (byTarget.profile) {
      const nextProfile = (byTarget.profile as { profile: Profile }).profile;
      setProfile(nextProfile);
      setFirstName(nextProfile.firstName);
      setLastName(nextProfile.lastName);
    }
    if (byTarget.addresses)
      setAddresses((byTarget.addresses as { addresses: Address[] }).addresses);
    if (byTarget.designs) setDesigns((byTarget.designs as { designs: Design[] }).designs);
    if (byTarget.credits) setCredits((byTarget.credits as { credits: Credits }).credits);
    if (byTarget.orders) setOrders((byTarget.orders as { orders: Order[] }).orders);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({ firstName, lastName, expectedRevision: profile.revision }),
      });
      setProfile((response as { profile: Profile }).profile);
      setNotice('Your details are saved.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }

  function changeAddress<K extends keyof typeof emptyAddress>(
    key: K,
    value: (typeof emptyAddress)[K],
  ): void {
    if (editingAddress) setEditingAddress({ ...editingAddress, [key]: value });
    else setAddressDraft((current) => ({ ...current, [key]: value }));
  }

  function beginEdit(address: Address): void {
    setEditingAddress(address);
    setNotice('');
    setError('');
  }
  function cancelEdit(): void {
    setEditingAddress(null);
    setAddressDraft(emptyAddress);
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/account/addresses', {
        method: editingAddress ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...addressForm,
          ...(editingAddress
            ? { id: editingAddress.id, expectedRevision: editingAddress.revision }
            : {}),
        }),
      });
      const saved = (response as { address: Address }).address;
      setAddresses((items) =>
        [...items.filter((address) => address.id !== saved.id), saved].sort(
          (a, b) => Number(b.isDefault) - Number(a.isDefault),
        ),
      );
      cancelEdit();
      setNotice('Your address is saved.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }

  async function removeAddress(address: Address): Promise<void> {
    if (!window.confirm('Remove this saved address?')) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await request('/api/account/addresses', {
        method: 'DELETE',
        body: JSON.stringify({ id: address.id, expectedRevision: address.revision }),
      });
      setAddresses((items) => items.filter((item) => item.id !== address.id));
      setNotice('Address removed.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }
}

function AccountSection({
  title,
  action,
  href,
  children,
}: {
  title: string;
  action: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <section className="account-production-section">
      <div>
        <h2>{title}</h2>
        <Link href={href}>{action}</Link>
      </div>
      {children}
    </section>
  );
}

function DesignCard({ design }: { design: Design }) {
  return (
    <button
      className="account-production-design-card"
      onClick={() => resumeDesign(design)}
      type="button"
    >
      {design.previewAssetId ? <img alt="" src={previewUrl(design)} /> : null}
      <span>{design.prompt || 'Untitled design'}</span>
      <b>Ready to customise</b>
    </button>
  );
}

function DesignRow({ design }: { design: Design }) {
  return (
    <button
      className="account-production-list-row"
      onClick={() => resumeDesign(design)}
      type="button"
    >
      <b>{design.prompt || 'Untitled design'}</b>
      <span>Saved {formatDate(design.updatedAt)}</span>
      <em>›</em>
    </button>
  );
}

function LedgerRow({ entry }: { entry: Credits['entries'][number] }) {
  return (
    <div className="account-production-log">
      <span>
        {ledgerLabel(entry)}
        <small>{formatDateTime(entry.createdAt)}</small>
      </span>
      <b className={entry.amount > 0 ? 'is-positive' : ''}>
        {entry.amount > 0 ? '+' : '−'}
        {Math.abs(entry.amount)}
      </b>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  return (
    <article className="account-production-list-row">
      <b>#{order.orderNumber}</b>
      <span>
        {order.itemCount} custom {order.itemCount === 1 ? 'shirt' : 'shirts'} ·{' '}
        {titleCase(order.status)}
      </span>
      <small>
        {formatDate(order.createdAt)} · {formatMoney(order.totalCents)}
      </small>
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="account-production-empty">{text}</p>;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to complete this request.');
  return body;
}

function resumeDesign(design: Design): void {
  window.localStorage.setItem('let-it-be-active-creation-project', design.projectId);
  if (design.generationId && design.previewAssetId) {
    window.localStorage.setItem(
      'let-it-be-active-creation-generation',
      JSON.stringify({
        projectId: design.projectId,
        generationId: design.generationId,
        previewAssetId: design.previewAssetId,
      }),
    );
  } else {
    window.localStorage.removeItem('let-it-be-active-creation-generation');
  }
  window.location.assign('/');
}
function previewUrl(design: Design): string {
  return `/api/projects/${encodeURIComponent(design.projectId)}/assets/${encodeURIComponent(design.previewAssetId!)}/preview`;
}
function addressLine(
  address: Pick<Address, 'line1' | 'line2' | 'city' | 'stateCode' | 'postalCode'>,
): string {
  return `${address.line1}${address.line2 ? `, ${address.line2}` : ''}, ${address.city}, ${address.stateCode} ${address.postalCode}`;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function ledgerLabel(entry: Credits['entries'][number]): string {
  return entry.entryType === 'CONSUME'
    ? 'Design created'
    : entry.entryType === 'REFUND'
      ? 'Credit returned'
      : entry.entryType === 'GRANT'
        ? 'Credits added'
        : entry.entryType.toLowerCase().replaceAll('_', ' ');
}
function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unable to complete this request.';
}
