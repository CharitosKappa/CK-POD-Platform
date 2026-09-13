'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { AddressDraft } from './customer-detail-editing';
import type { CustomerDetail } from './customer-types';

type CustomerAddress = CustomerDetail['addresses'][number];
type EditorState =
  | Readonly<{ mode: 'list' }>
  | Readonly<{ mode: 'create' }>
  | Readonly<{ mode: 'edit'; address: CustomerAddress }>;

const emptyAddress: AddressDraft = {
  recipientName: '',
  phone: '',
  countryCode: 'US',
  line1: '',
  line2: '',
  city: '',
  stateCode: '',
  postalCode: '',
};

export function CustomerAddressManagerModal({
  customer,
  onClose,
  onSaved,
  returnFocusRef,
}: Readonly<{
  customer: CustomerDetail;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'list' });
  const [draft, setDraft] = useState<AddressDraft>(emptyAddress);
  const [makeDefault, setMakeDefault] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreDialogFocus(returnFocusRef, previouslyFocused.current);
    };
  }, [returnFocusRef]);

  useEffect(() => {
    if (editor.mode !== 'list') firstField.current?.focus();

    function handleDialogKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (editor.mode === 'list') onClose();
        else setEditor({ mode: 'list' });
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = dialogFocusableElements(dialog.current);
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      focusable[nextDialogFocusIndex(activeIndex, focusable.length, event.shiftKey)]?.focus();
    }
    document.addEventListener('keydown', handleDialogKeyboard);
    return () => document.removeEventListener('keydown', handleDialogKeyboard);
  }, [editor.mode, onClose]);

  function startCreate() {
    setDraft({ ...emptyAddress, recipientName: customer.name });
    setMakeDefault(!customer.addresses.some((address) => address.source === 'PROFILE'));
    setPendingDelete(undefined);
    setError(undefined);
    setEditor({ mode: 'create' });
  }

  function startEdit(address: CustomerAddress) {
    setDraft(addressDraft(address));
    setMakeDefault(address.isDefault);
    setPendingDelete(undefined);
    setError(undefined);
    setEditor({ mode: 'edit', address });
  }

  async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const editing = editor.mode === 'edit' ? editor.address : null;
      const endpoint = editing
        ? `/api/admin/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(editing.id)}`
        : `/api/admin/customers/${encodeURIComponent(customer.id)}/addresses`;
      await request(endpoint, editing ? 'PATCH' : 'POST', { ...draft, isDefault: makeDefault });
      await onSaved(editing ? 'Customer address updated.' : 'Customer address added.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save customer address.');
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(address: CustomerAddress) {
    setBusy(true);
    setError(undefined);
    try {
      await request(
        `/api/admin/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(address.id)}`,
        'PATCH',
        { ...addressDraft(address), isDefault: true },
      );
      await onSaved('Default address updated.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the default address.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAddress(addressId: string) {
    setBusy(true);
    setError(undefined);
    try {
      await request(
        `/api/admin/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(addressId)}`,
        'DELETE',
      );
      await onSaved('Customer address removed.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove customer address.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="customer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-describedby={error ? 'customer-address-error' : undefined}
        aria-labelledby="customer-address-title"
        aria-modal="true"
        className="customer-edit-modal customer-address-manager-modal"
        ref={dialog}
        role="dialog"
      >
        <header>
          <h2 id="customer-address-title">
            {editor.mode === 'list'
              ? 'Manage addresses'
              : editor.mode === 'create'
                ? 'Add address'
                : 'Edit address'}
          </h2>
          <button aria-label="Close dialog" onClick={onClose} type="button">
            ×
          </button>
        </header>

        {editor.mode === 'list' ? (
          <>
            <div className="customer-modal-body customer-address-manager-body">
              <button
                className="customer-address-add-button"
                data-dialog-initial-focus
                disabled={busy}
                onClick={startCreate}
                type="button"
              >
                <span aria-hidden="true">＋</span>
                Add address
              </button>
              <div className="customer-address-list">
                {customer.addresses.length ? (
                  customer.addresses.map((address) => (
                    <AddressCard
                      address={address}
                      busy={busy}
                      key={`${address.source}-${address.id}`}
                      onDelete={() => setPendingDelete(address.id)}
                      onEdit={() => startEdit(address)}
                      onSetDefault={() => void setDefault(address)}
                      pendingDelete={pendingDelete === address.id}
                      onCancelDelete={() => setPendingDelete(undefined)}
                      onConfirmDelete={() => void removeAddress(address.id)}
                    />
                  ))
                ) : (
                  <p className="customer-empty-inline">No address saved.</p>
                )}
              </div>
              {error ? (
                <p className="customer-modal-error" id="customer-address-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <footer>
              <button className="customer-button secondary" onClick={onClose} type="button">
                Done
              </button>
            </footer>
          </>
        ) : (
          <form noValidate onSubmit={saveAddress}>
            <div className="customer-modal-body">
              <AddressEditor draft={draft} firstField={firstField} setDraft={setDraft} />
              <label className="customer-address-default-toggle">
                <input
                  checked={makeDefault}
                  disabled={editor.mode === 'edit' && editor.address.isDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                  type="checkbox"
                />
                Use as default address
              </label>
              {error ? (
                <p className="customer-modal-error" id="customer-address-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <footer>
              <button
                className="customer-button secondary"
                disabled={busy}
                onClick={() => setEditor({ mode: 'list' })}
                type="button"
              >
                Back
              </button>
              <button className="customer-button primary" disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Save address'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

export function nextDialogFocusIndex(activeIndex: number, count: number, backwards: boolean) {
  if (count <= 0) return -1;
  if (activeIndex < 0) return backwards ? count - 1 : 0;
  return (activeIndex + (backwards ? -1 : 1) + count) % count;
}

export function restoreDialogFocus(
  persistentTrigger: React.RefObject<HTMLElement | null> | undefined,
  previouslyFocused: HTMLElement | null,
) {
  const target = persistentTrigger?.current?.isConnected
    ? persistentTrigger.current
    : previouslyFocused?.isConnected
      ? previouslyFocused
      : null;
  target?.focus();
}

function dialogFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
}

function AddressCard({
  address,
  busy,
  onCancelDelete,
  onConfirmDelete,
  onDelete,
  onEdit,
  onSetDefault,
  pendingDelete,
}: Readonly<{
  address: CustomerAddress;
  busy: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSetDefault: () => void;
  pendingDelete: boolean;
}>) {
  const editable = address.source === 'PROFILE';
  return (
    <article className="customer-address-card">
      <div>
        <p className="customer-address-card-badges">
          {address.isDefault ? <span>Default</span> : null}
          {!editable ? <span>{sourceLabel(address.source)} · read only</span> : null}
        </p>
        <strong>{address.recipientName}</strong>
        <address>
          {address.line1}
          {address.line2 ? <>, {address.line2}</> : null}
          <br />
          {[address.city, address.stateCode, address.postalCode].filter(Boolean).join(', ')}
          <br />
          {address.countryCode}
          {address.phone ? (
            <>
              <br />
              {address.phone}
            </>
          ) : null}
        </address>
      </div>
      {editable ? (
        <div className="customer-address-card-actions">
          {!address.isDefault ? (
            <button disabled={busy} onClick={onSetDefault} type="button">
              Set as default
            </button>
          ) : null}
          <button
            aria-label={`Edit address for ${address.recipientName}`}
            disabled={busy}
            onClick={onEdit}
            type="button"
          >
            Edit
          </button>
          {pendingDelete ? (
            <span className="customer-address-delete-confirm">
              Remove?
              <button disabled={busy} onClick={onConfirmDelete} type="button">
                Yes
              </button>
              <button disabled={busy} onClick={onCancelDelete} type="button">
                No
              </button>
            </span>
          ) : (
            <button className="danger" disabled={busy} onClick={onDelete} type="button">
              Remove
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

function AddressEditor({
  draft,
  firstField,
  setDraft,
}: Readonly<{
  draft: AddressDraft;
  firstField: React.RefObject<HTMLInputElement | null>;
  setDraft: React.Dispatch<React.SetStateAction<AddressDraft>>;
}>) {
  function update<Key extends keyof AddressDraft>(key: Key, value: AddressDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="customer-modal-grid">
      <Field full label="Recipient name">
        <input
          autoComplete="name"
          ref={firstField}
          required
          value={draft.recipientName}
          onChange={(event) => update('recipientName', event.target.value)}
        />
      </Field>
      <Field full label="Country / region">
        <select
          autoComplete="country"
          required
          value={draft.countryCode}
          onChange={(event) => update('countryCode', event.target.value)}
        >
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="GB">United Kingdom</option>
        </select>
      </Field>
      <Field full label="Address">
        <input
          autoComplete="address-line1"
          required
          value={draft.line1}
          onChange={(event) => update('line1', event.target.value)}
        />
      </Field>
      <Field full label="Apartment, suite, etc.">
        <input
          autoComplete="address-line2"
          value={draft.line2}
          onChange={(event) => update('line2', event.target.value)}
        />
      </Field>
      <Field label="City">
        <input
          autoComplete="address-level2"
          required
          value={draft.city}
          onChange={(event) => update('city', event.target.value)}
        />
      </Field>
      <Field label="State / province">
        <input
          autoComplete="address-level1"
          value={draft.stateCode}
          onChange={(event) => update('stateCode', event.target.value)}
        />
      </Field>
      <Field label="Postal code">
        <input
          autoComplete="postal-code"
          required
          value={draft.postalCode}
          onChange={(event) => update('postalCode', event.target.value)}
        />
      </Field>
      <Field full label="Phone number">
        <input
          autoComplete="tel"
          type="tel"
          value={draft.phone}
          onChange={(event) => update('phone', event.target.value)}
        />
      </Field>
    </div>
  );
}

function Field({
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

function addressDraft(address: CustomerAddress): AddressDraft {
  return {
    recipientName: address.recipientName,
    phone: address.phone ?? '',
    countryCode: address.countryCode,
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city,
    stateCode: address.stateCode ?? '',
    postalCode: address.postalCode,
  };
}

function sourceLabel(source: CustomerAddress['source']) {
  if (source === 'SAVED') return 'Account address';
  if (source === 'ORDER') return 'Order address';
  return 'Customer address';
}

async function request(endpoint: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const response = await fetch(endpoint, {
    method,
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Could not update customer address.');
}
