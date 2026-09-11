'use client';

import { useEffect, useRef, useState } from 'react';

import {
  addressDraftFrom,
  addressUpdatePayload,
  contactDraftFrom,
  contactUpdatePayload,
  type AddressDraft,
  type ContactDraft,
} from './customer-detail-editing';
import type { CustomerDetail } from './customer-types';

export type CustomerDetailModalName = 'customer' | 'address';

export function CustomerDetailModal({
  customer,
  modal,
  onClose,
  onSaved,
}: Readonly<{
  customer: CustomerDetail;
  modal: CustomerDetailModalName;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const [contact, setContact] = useState(() => contactDraftFrom(customer));
  const [address, setAddress] = useState(() => addressDraftFrom(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstField.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/customers/${encodeURIComponent(customer.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          modal === 'customer'
            ? contactUpdatePayload(customer, contact)
            : addressUpdatePayload(customer, address),
        ),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update customer.');
      await onSaved(modal === 'customer' ? 'Customer updated.' : 'Default address updated.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update customer.');
    } finally {
      setSaving(false);
    }
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const title = modal === 'customer' ? 'Edit customer' : 'Manage default address';
  return (
    <div
      className="customer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-describedby={error ? 'customer-modal-error' : undefined}
        aria-labelledby="customer-modal-title"
        aria-modal="true"
        className="customer-edit-modal"
        onKeyDown={keepFocusInside}
        ref={dialog}
        role="dialog"
      >
        <header>
          <h2 id="customer-modal-title">{title}</h2>
          <button aria-label="Close dialog" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="customer-modal-body">
            {modal === 'customer' ? (
              <CustomerFields contact={contact} firstField={firstField} setContact={setContact} />
            ) : (
              <AddressFields address={address} firstField={firstField} setAddress={setAddress} />
            )}
            {error ? (
              <p className="customer-modal-error" id="customer-modal-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer>
            <button className="customer-button secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="customer-button primary" disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function CustomerFields({
  contact,
  firstField,
  setContact,
}: Readonly<{
  contact: ContactDraft;
  firstField: React.RefObject<HTMLInputElement | null>;
  setContact: React.Dispatch<React.SetStateAction<ContactDraft>>;
}>) {
  return (
    <>
      <div className="customer-modal-grid">
        <ModalField label="First name">
          <input
            autoComplete="given-name"
            ref={firstField}
            value={contact.firstName}
            onChange={(event) =>
              setContact((current) => ({ ...current, firstName: event.target.value }))
            }
          />
        </ModalField>
        <ModalField label="Last name">
          <input
            autoComplete="family-name"
            value={contact.lastName}
            onChange={(event) =>
              setContact((current) => ({ ...current, lastName: event.target.value }))
            }
          />
        </ModalField>
        <ModalField full label="Email">
          <input
            autoComplete="email"
            required
            type="email"
            value={contact.email}
            onChange={(event) =>
              setContact((current) => ({ ...current, email: event.target.value }))
            }
          />
        </ModalField>
        <ModalField full label="Phone number">
          <input
            autoComplete="tel"
            type="tel"
            value={contact.phone}
            onChange={(event) =>
              setContact((current) => ({ ...current, phone: event.target.value }))
            }
          />
        </ModalField>
      </div>
      <fieldset className="customer-modal-marketing">
        <legend>Marketing subscriptions</legend>
        <label>
          <input
            checked={contact.emailMarketingStatus === 'SUBSCRIBED'}
            onChange={(event) =>
              setContact((current) => ({
                ...current,
                emailMarketingStatus: event.target.checked ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED',
              }))
            }
            type="checkbox"
          />
          Email marketing
        </label>
        <label>
          <input
            checked={contact.smsMarketingStatus === 'SUBSCRIBED'}
            onChange={(event) =>
              setContact((current) => ({
                ...current,
                smsMarketingStatus: event.target.checked ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED',
              }))
            }
            type="checkbox"
          />
          SMS marketing
        </label>
      </fieldset>
    </>
  );
}

function AddressFields({
  address,
  firstField,
  setAddress,
}: Readonly<{
  address: AddressDraft;
  firstField: React.RefObject<HTMLInputElement | null>;
  setAddress: React.Dispatch<React.SetStateAction<AddressDraft>>;
}>) {
  function update<Key extends keyof AddressDraft>(key: Key, value: AddressDraft[Key]) {
    setAddress((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="customer-modal-grid">
      <ModalField full label="Country / region">
        <select
          autoComplete="country"
          value={address.countryCode}
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
      </ModalField>
      <ModalField full label="Address">
        <input
          autoComplete="address-line1"
          ref={firstField}
          value={address.line1}
          onChange={(event) => update('line1', event.target.value)}
        />
      </ModalField>
      <ModalField full label="Apartment, suite, etc.">
        <input
          autoComplete="address-line2"
          value={address.line2}
          onChange={(event) => update('line2', event.target.value)}
        />
      </ModalField>
      <ModalField label="City">
        <input
          autoComplete="address-level2"
          value={address.city}
          onChange={(event) => update('city', event.target.value)}
        />
      </ModalField>
      <ModalField label="State / province">
        <input
          autoComplete="address-level1"
          value={address.stateCode}
          onChange={(event) => update('stateCode', event.target.value)}
        />
      </ModalField>
      <ModalField label="Postal code">
        <input
          autoComplete="postal-code"
          value={address.postalCode}
          onChange={(event) => update('postalCode', event.target.value)}
        />
      </ModalField>
    </div>
  );
}

function ModalField({
  children,
  full,
  label,
}: Readonly<{ children: React.ReactNode; full?: boolean; label: string }>) {
  return (
    <label className={full ? 'full' : undefined}>
      <span>{label}</span>
      {children}
    </label>
  );
}
