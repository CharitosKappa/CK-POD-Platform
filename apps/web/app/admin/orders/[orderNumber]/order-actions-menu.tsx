'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { adminApiFetch } from '../../../../lib/admin-api';
import type { OrderDetail } from './order-detail-types';
import {
  hasOrderActionJournal,
  orderActionPath,
  type OrderActionName,
} from './order-action-client';
import {
  OrderActionModal,
  RecordedOrderActionModal,
  type OrderActionModalProps,
} from './order-action-modal';
import { CancelOrderModal, CancellationRecoveryModal } from './cancel-order-modal';
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
  recoverCancellation: 'Review cancellation',
};
export function orderActionOptions(
  eligibility: OrderDetail['eligibility'],
  recovery?: OrderDetail['actionRecovery'],
  pending: OrderActionName[] = [],
) {
  const options = (['edit', 'cancel', 'refund', 'return', 'archive', 'unarchive'] as const)
    .filter(
      (action) => eligibility.actions[action] || (recovery?.canResume && pending.includes(action)),
    )
    .filter((action) => action !== 'cancel' || !recovery?.cancellation)
    .map((action): { action: OrderActionName; label: string } => ({
      action,
      label:
        recovery?.canResume && pending.includes(action)
          ? `Check ${action === 'cancel' ? 'cancellation' : action} request`
          : labels[action],
    }));
  if (recovery?.cancellation)
    options.push({ action: 'recoverCancellation', label: labels.recoverCancellation });
  return options;
}

export function OrderActionsMenu({
  eligibility,
  onSelect,
  recovery,
  pending,
}: Readonly<{
  eligibility: OrderDetail['eligibility'];
  onSelect: (action: OrderActionName) => void;
  recovery?: OrderDetail['actionRecovery'];
  pending?: OrderActionName[];
}>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const options = orderActionOptions(eligibility, recovery, pending);
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
    recoverCancellation: CancellationRecoveryModal,
  };
  const Component = components[props.action];
  const resource = orderActionPath(props.apiBase, props.order.orderNumber, props.action)
    .split('/')
    .at(-1)!;
  const method = props.action === 'unarchive' ? 'DELETE' : 'POST';
  if (
    fresh?.actionRecovery?.canResume &&
    hasOrderActionJournal(orderActionPath(props.apiBase, fresh.orderNumber, props.action), method)
  ) {
    return (
      <RecordedOrderActionModal
        {...props}
        order={fresh}
        actionName={props.action}
        resource={resource}
        method={method}
      />
    );
  }
  if (
    fresh &&
    (props.action === 'recoverCancellation'
      ? fresh.actionRecovery?.cancellation
      : fresh.eligibility.actions[props.action])
  )
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
