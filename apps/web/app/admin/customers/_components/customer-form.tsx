'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { CustomerDetail } from './customer-types';
import type { CustomerLocale } from './customer-types';

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryCode: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  postalCode: string;
  emailConsent: boolean;
  smsConsent: boolean;
  preferredLocale: CustomerLocale;
  tags: string;
  note: string;
};

const empty: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  countryCode: '',
  line1: '',
  line2: '',
  city: '',
  stateCode: '',
  postalCode: '',
  emailConsent: false,
  smsConsent: false,
  preferredLocale: 'en',
  tags: '',
  note: '',
};

export function CustomerForm({ customerId }: Readonly<{ customerId?: string }>) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(!!customerId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [existingId, setExistingId] = useState<string>();

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    void fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as { customer?: CustomerDetail; error?: string };
        if (!response.ok || !payload.customer)
          throw new Error(payload.error ?? 'Could not load customer.');
        const customer = payload.customer;
        const address = customer.addresses[0];
        setForm({
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone ?? '',
          countryCode: address?.countryCode ?? '',
          line1: address?.line1 ?? '',
          line2: address?.line2 ?? '',
          city: address?.city ?? '',
          stateCode: address?.stateCode ?? '',
          postalCode: address?.postalCode ?? '',
          emailConsent: customer.emailMarketingStatus === 'SUBSCRIBED',
          smsConsent: customer.smsMarketingStatus === 'SUBSCRIBED',
          preferredLocale: customer.preferredLocale,
          tags: customer.tags.join(', '),
          note: '',
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load customer.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [customerId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setExistingId(undefined);
    try {
      const response = await fetch(
        customerId
          ? `/api/admin/customers/${encodeURIComponent(customerId)}`
          : '/api/admin/customers',
        {
          method: customerId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            phone: form.phone,
            emailMarketingStatus: form.emailConsent ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED',
            smsMarketingStatus: form.smsConsent ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED',
            preferredLocale: form.preferredLocale,
            address: {
              countryCode: form.countryCode,
              line1: form.line1,
              line2: form.line2,
              city: form.city,
              stateCode: form.stateCode,
              postalCode: form.postalCode,
            },
            tags: form.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            ...(!customerId && form.note.trim() ? { note: form.note } : {}),
          }),
        },
      );
      const payload = (await response.json()) as { customerId?: string; error?: string };
      if (!response.ok) {
        if (response.status === 409 && payload.customerId) setExistingId(payload.customerId);
        throw new Error(payload.error ?? 'Could not save customer.');
      }
      const destination = customerId ?? payload.customerId;
      if (!destination) throw new Error('Customer saved, but the profile could not be opened.');
      router.push(`/admin/customers/${encodeURIComponent(destination)}?saved=1`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="customer-admin-page">
        <p className="customer-feedback">Loading customer…</p>
      </main>
    );

  return (
    <main className="customer-admin-page customer-form-page">
      <Link
        className="customer-back-link"
        href={customerId ? `/admin/customers/${customerId}` : '/admin/customers'}
      >
        ← {customerId ? 'Customer' : 'Customers'}
      </Link>
      <header className="customer-page-heading compact">
        <div>
          <p>Customer profile</p>
          <h1>{customerId ? 'Edit customer' : 'Add customer'}</h1>
          <span>
            {customerId
              ? 'Update contact details, address and preferences.'
              : 'Create a profile for orders, support and marketing.'}
          </span>
        </div>
      </header>
      <form onSubmit={submit} noValidate>
        {error ? (
          <div className="customer-feedback error" role="alert">
            <strong>Customer could not be saved.</strong>
            <span>{error}</span>
            {existingId ? (
              <Link href={`/admin/customers/${existingId}`}>Open existing customer</Link>
            ) : null}
          </div>
        ) : null}
        <div className="customer-form-grid">
          <div className="customer-form-main">
            <section className="customer-card customer-form-card">
              <header>
                <h2>Customer overview</h2>
                <p>The contact details staff use to identify this customer.</p>
              </header>
              <div className="customer-field-grid">
                <Field label="First name">
                  <input
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={(event) => update('firstName', event.target.value)}
                  />
                </Field>
                <Field label="Last name">
                  <input
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={(event) => update('lastName', event.target.value)}
                  />
                </Field>
                <Field label="Email" required>
                  <input
                    autoComplete="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    autoComplete="tel"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </Field>
                <Field label="Notification language" full>
                  <select
                    value={form.preferredLocale}
                    onChange={(event) =>
                      update('preferredLocale', event.target.value as CustomerLocale)
                    }
                  >
                    <option value="en">English</option>
                  </select>
                </Field>
              </div>
            </section>
            <section className="customer-card customer-form-card">
              <header>
                <h2>Primary address</h2>
                <p>Optional until any address field is entered.</p>
              </header>
              <div className="customer-field-grid">
                <Field label="Country / region" full>
                  <select
                    autoComplete="country"
                    value={form.countryCode}
                    onChange={(event) => update('countryCode', event.target.value)}
                  >
                    <option value="">Select country or region</option>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="GR">Greece</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="IT">Italy</option>
                    <option value="ES">Spain</option>
                  </select>
                </Field>
                <Field label="Address" full>
                  <input
                    autoComplete="address-line1"
                    value={form.line1}
                    onChange={(event) => update('line1', event.target.value)}
                  />
                </Field>
                <Field label="Apartment, suite, etc.">
                  <input
                    autoComplete="address-line2"
                    value={form.line2}
                    onChange={(event) => update('line2', event.target.value)}
                  />
                </Field>
                <Field label="City">
                  <input
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={(event) => update('city', event.target.value)}
                  />
                </Field>
                <Field label="State / province">
                  <input
                    autoComplete="address-level1"
                    value={form.stateCode}
                    onChange={(event) => update('stateCode', event.target.value)}
                  />
                </Field>
                <Field label="Postal code">
                  <input
                    autoComplete="postal-code"
                    value={form.postalCode}
                    onChange={(event) => update('postalCode', event.target.value)}
                  />
                </Field>
              </div>
            </section>
          </div>
          <aside className="customer-form-side">
            <section className="customer-card customer-form-card">
              <header>
                <h2>Marketing</h2>
                <p>Record only consent the customer has explicitly provided.</p>
              </header>
              <label className="customer-check-row">
                <input
                  type="checkbox"
                  checked={form.emailConsent}
                  onChange={(event) => update('emailConsent', event.target.checked)}
                />
                <span>
                  <strong>Email marketing</strong>
                  <small>Customer agreed to receive marketing emails.</small>
                </span>
              </label>
              <label className="customer-check-row">
                <input
                  type="checkbox"
                  checked={form.smsConsent}
                  onChange={(event) => update('smsConsent', event.target.checked)}
                />
                <span>
                  <strong>SMS marketing</strong>
                  <small>Customer agreed to receive marketing texts.</small>
                </span>
              </label>
            </section>
            <section className="customer-card customer-form-card">
              <header>
                <h2>Tags</h2>
                <p>Separate tags with commas.</p>
              </header>
              <Field label="Customer tags">
                <input
                  value={form.tags}
                  onChange={(event) => update('tags', event.target.value)}
                  placeholder="VIP, repeat buyer"
                />
              </Field>
            </section>
            {!customerId ? (
              <section className="customer-card customer-form-card">
                <header>
                  <h2>Internal note</h2>
                  <p>Only staff can see this note.</p>
                </header>
                <Field label="Note">
                  <textarea
                    maxLength={2000}
                    value={form.note}
                    onChange={(event) => update('note', event.target.value)}
                  />
                </Field>
              </section>
            ) : null}
          </aside>
        </div>
        <footer className="customer-form-actions">
          <Link
            className="customer-button secondary"
            href={customerId ? `/admin/customers/${customerId}` : '/admin/customers'}
          >
            Cancel
          </Link>
          <button className="customer-button primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save customer'}
          </button>
        </footer>
      </form>
    </main>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: Readonly<{ label: string; required?: boolean; full?: boolean; children: React.ReactNode }>) {
  return (
    <label className={`customer-field ${full ? 'full' : ''}`}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}
