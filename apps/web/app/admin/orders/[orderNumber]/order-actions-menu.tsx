'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { adminApiFetch } from '../../../../lib/admin-api';
import type { OrderDetail } from './order-detail-types';
import type { OrderActionName } from './order-action-client';
import { OrderActionModal, type OrderActionModalProps } from './order-action-modal';
import { CancelOrderModal } from './cancel-order-modal';
import { RefundOrderModal } from './refund-order-modal';
import { ReturnOrderModal } from './return-order-modal';
import { EditOrderModal } from './edit-order-modal';
import { ArchiveOrderModal } from './archive-order-modal';

const labels: Record<OrderActionName, string> = {
  edit: 'Edit order',
  cancel: 'Cancel order',
  refund: 'Refund',
  return: 'Create return',
  archive: 'Archive order',
  unarchive: 'Unarchive order',
};
export function orderActionOptions(eligibility: OrderDetail['eligibility']) {
  return (Object.keys(labels) as OrderActionName[])
    .filter((action) => eligibility.actions[action])
    .map((action) => ({ action, label: labels[action] }));
}

export function OrderActionsMenu({
  eligibility,
  onSelect,
}: Readonly<{
  eligibility: OrderDetail['eligibility'];
  onSelect: (action: OrderActionName) => void;
}>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const options = orderActionOptions(eligibility);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', pointer);
    return () => document.removeEventListener('pointerdown', pointer);
  }, [open]);
  if (!options.length) return null;
  return (
    <div
      className="order-actions-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(
          root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
        );
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="order-action-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (!open && event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        More actions <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div id={menuId} className="order-actions-popover" role="menu" aria-label="Order actions">
          {options.map(({ action, label }) => (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              key={action}
              className={action === 'cancel' ? 'is-destructive' : undefined}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                onSelect(action);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Fresh server state is loaded before a form opens; a stale page never seeds a mutation. */
export function OrderActionHost(props: OrderActionModalProps & { action: OrderActionName }) {
  const [fresh, setFresh] = useState<OrderDetail>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void (async () => {
      try {
        const response = await adminApiFetch(
          `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as { order?: OrderDetail; error?: string };
        if (!response.ok || !result.order)
          throw new Error(result.error ?? 'Could not load current order permissions.');
        if (!controller.signal.aborted) setFresh(result.order);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Could not load current order permissions.',
          );
      }
    })();
    return () => controller.abort();
  }, [props.apiBase, props.order.orderNumber, reload]);
  const components = {
    edit: EditOrderModal,
    cancel: CancelOrderModal,
    refund: RefundOrderModal,
    return: ReturnOrderModal,
    archive: ArchiveOrderModal,
    unarchive: ArchiveOrderModal,
  };
  const Component = components[props.action];
  if (fresh && fresh.eligibility.actions[props.action])
    return <Component {...props} order={fresh} />;
  return (
    <OrderActionModal
      title={labels[props.action]}
      onClose={props.onClose}
      footer={
        <>
          <button className="order-action-button" type="button" onClick={props.onClose}>
            Close
          </button>
          {error ? (
            <button
              className="order-action-button is-primary"
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              Try again
            </button>
          ) : null}
        </>
      }
    >
      <p role={error || fresh ? 'alert' : 'status'} className="order-action-hint">
        {error ??
          (fresh
            ? 'This action is no longer available for the current order. Close this dialog to review the latest details.'
            : 'Loading current order details…')}
      </p>
    </OrderActionModal>
  );
}
