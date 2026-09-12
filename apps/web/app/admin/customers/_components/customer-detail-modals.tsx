'use client';

import React, { useEffect, useRef, useState } from 'react';

import {
  addressDraftFrom,
  addressUpdatePayload,
  contactDraftFrom,
  contactUpdatePayload,
  type AddressDraft,
  type ContactDraft,
} from './customer-detail-editing';
import { filterTagOptions } from './customer-detail-sidebar';
import type { CustomerDetail } from './customer-types';

export type CustomerDetailModalName = 'customer' | 'address' | 'marketing' | 'tags' | 'note';

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
  const [selectedTags, setSelectedTags] = useState(() => customer.tags);
  const [tagCatalog, setTagCatalog] = useState(() => customer.tags);
  const [tagQuery, setTagQuery] = useState('');
  const [tagCatalogLoading, setTagCatalogLoading] = useState(modal === 'tags');
  const [tagCatalogError, setTagCatalogError] = useState<string>();
  const [note, setNote] = useState('');
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

  useEffect(() => {
    if (modal !== 'tags') return;
    const controller = new AbortController();
    async function loadTagCatalog() {
      setTagCatalogLoading(true);
      setTagCatalogError(undefined);
      try {
        const response = await fetch('/api/admin/customer-tags', { signal: controller.signal });
        const payload = (await response.json()) as { tags?: string[]; error?: string };
        if (!response.ok || !payload.tags)
          throw new Error(payload.error ?? 'Could not load customer tags.');
        setTagCatalog([...new Set([...payload.tags, ...customer.tags])]);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setTagCatalogError(
          reason instanceof Error ? reason.message : 'Could not load customer tags.',
        );
      } finally {
        if (!controller.signal.aborted) setTagCatalogLoading(false);
      }
    }
    void loadTagCatalog();
    return () => controller.abort();
  }, [customer.tags, modal]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const endpoint =
        modal === 'tags'
          ? `/api/admin/customers/${encodeURIComponent(customer.id)}/tags`
          : modal === 'note'
            ? `/api/admin/customers/${encodeURIComponent(customer.id)}/notes`
            : `/api/admin/customers/${encodeURIComponent(customer.id)}`;
      const body =
        modal === 'tags'
          ? { tags: selectedTags }
          : modal === 'note'
            ? { body: note.trim() }
            : modal === 'address'
              ? addressUpdatePayload(customer, address)
              : contactUpdatePayload(customer, contact);
      const response = await fetch(endpoint, {
        method: modal === 'tags' || modal === 'note' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update customer.');
      await onSaved(successMessage(modal));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update customer.');
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())
        ? current.filter((value) => value.toLocaleLowerCase() !== tag.toLocaleLowerCase())
        : [...current, tag],
    );
  }

  function addTag(tag: string) {
    if (selectedTags.length >= 20 || tag.length > 48) return;
    setTagCatalog((current) => [...new Set([...current, tag])]);
    setSelectedTags((current) => [...current, tag]);
    setTagQuery('');
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

  const title = modalTitle(modal);
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
            ) : modal === 'address' ? (
              <AddressFields address={address} firstField={firstField} setAddress={setAddress} />
            ) : modal === 'marketing' ? (
              <MarketingFields contact={contact} setContact={setContact} />
            ) : modal === 'tags' ? (
              <CustomerTagPicker
                catalog={tagCatalog}
                loading={tagCatalogLoading}
                onAdd={addTag}
                onQueryChange={setTagQuery}
                onToggle={toggleTag}
                query={tagQuery}
                selectedTags={selectedTags}
                {...(tagCatalogError ? { error: tagCatalogError } : {})}
              />
            ) : (
              <div className="customer-modal-grid">
                <ModalField full label="Internal note">
                  <textarea
                    autoFocus
                    maxLength={2000}
                    placeholder="Add context for your team…"
                    rows={5}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </ModalField>
                <p className="customer-modal-field-hint">Only staff can see customer notes.</p>
              </div>
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
            <button
              className="customer-button primary"
              disabled={saving || (modal === 'note' && !note.trim())}
              type="submit"
            >
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
        <ModalField full label="Language">
          <select
            value={contact.preferredLocale}
            onChange={(event) =>
              setContact((current) => ({
                ...current,
                preferredLocale: event.target.value as ContactDraft['preferredLocale'],
              }))
            }
          >
            <option value="en">English</option>
          </select>
          <small>Transactional and promotional messages use this language.</small>
        </ModalField>
      </div>
    </>
  );
}

function MarketingFields({
  contact,
  setContact,
}: Readonly<{
  contact: ContactDraft;
  setContact: React.Dispatch<React.SetStateAction<ContactDraft>>;
}>) {
  return (
    <fieldset className="customer-modal-marketing">
      <legend>Marketing subscriptions</legend>
      <label>
        <input
          autoFocus
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
  );
}

function CustomerTagPicker({
  catalog,
  error,
  loading,
  onAdd,
  onQueryChange,
  onToggle,
  query,
  selectedTags,
}: Readonly<{
  catalog: string[];
  error?: string;
  loading: boolean;
  onAdd: (tag: string) => void;
  onQueryChange: (query: string) => void;
  onToggle: (tag: string) => void;
  query: string;
  selectedTags: string[];
}>) {
  const options = filterTagOptions(catalog, selectedTags, query);
  const resultCount = options.selected.length + options.available.length;
  return (
    <div className="customer-tag-picker">
      <label htmlFor="customer-tag-search">Tags</label>
      <div className="customer-tag-search-row">
        <SearchIcon />
        <input
          autoComplete="off"
          autoFocus
          id="customer-tag-search"
          maxLength={48}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search or add tags"
          type="search"
          value={query}
        />
        {query ? (
          <button aria-label="Clear tag search" onClick={() => onQueryChange('')} type="button">
            ×
          </button>
        ) : null}
      </div>
      <div className="customer-tag-results">
        {query ? (
          <p className="customer-tag-result-count">
            {resultCount} {resultCount === 1 ? 'result' : 'results'}
          </p>
        ) : null}
        {loading ? <p className="customer-tag-picker-status">Loading customer tags…</p> : null}
        {error ? (
          <p className="customer-tag-picker-status error" role="alert">
            {error}
          </p>
        ) : null}
        {options.selected.map((tag) => (
          <TagOption checked key={`selected-${tag}`} onChange={() => onToggle(tag)} tag={tag} />
        ))}
        {options.available.map((tag) => (
          <TagOption
            checked={false}
            key={`available-${tag}`}
            onChange={() => onToggle(tag)}
            tag={tag}
          />
        ))}
        {options.addable ? (
          <button
            className="customer-tag-add-option"
            disabled={selectedTags.length >= 20 || options.addable.length > 48}
            onClick={() => onAdd(options.addable!)}
            type="button"
          >
            <span aria-hidden="true">＋</span> Add “{options.addable}”
          </button>
        ) : null}
        {!loading && !error && !resultCount && !options.addable ? (
          <p className="customer-tag-picker-status">No customer tags found.</p>
        ) : null}
      </div>
      <small>{selectedTags.length} of 20 tags selected</small>
    </div>
  );
}

function TagOption({
  checked,
  onChange,
  tag,
}: Readonly<{ checked: boolean; onChange: () => void; tag: string }>) {
  return (
    <label className={checked ? 'selected' : undefined}>
      <input checked={checked} onChange={onChange} type="checkbox" />
      <span>{tag}</span>
    </label>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="8.5" cy="8.5" r="5.2" />
      <path d="m12.4 12.4 4 4" />
    </svg>
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

function modalTitle(modal: CustomerDetailModalName) {
  if (modal === 'customer') return 'Edit contact information';
  if (modal === 'address') return 'Manage default address';
  if (modal === 'marketing') return 'Edit marketing settings';
  if (modal === 'tags') return 'Edit customer tags';
  return 'Add customer note';
}

function successMessage(modal: CustomerDetailModalName) {
  if (modal === 'customer') return 'Customer updated.';
  if (modal === 'address') return 'Default address updated.';
  if (modal === 'marketing') return 'Marketing preferences updated.';
  if (modal === 'tags') return 'Customer tags updated.';
  return 'Internal note added.';
}
