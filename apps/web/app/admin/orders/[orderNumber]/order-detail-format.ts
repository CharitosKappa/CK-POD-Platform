import type { LayerTone, OrderAddress } from './order-detail-types';

const countries: Record<string, string> = { US: 'United States' };

const tones: Record<string, LayerTone> = {
  PENDING: 'warning',
  PAID: 'success',
  REFUNDED: 'neutral',
  DELIVERED: 'success',
  FULFILLED: 'success',
  PRINTED: 'success',
  READY_FOR_PRODUCTION: 'success',
  PARTIALLY_REFUNDED: 'warning',
  UNFULFILLED: 'warning',
  PARTIALLY_FULFILLED: 'warning',
  PARTIALLY_IN_PRODUCTION: 'warning',
  PARTIALLY_PRINTED: 'warning',
  IN_PRODUCTION: 'info',
  SUBMITTED: 'info',
  SUBMITTING: 'info',
  FAILED: 'danger',
  CANCELLED: 'danger',
  NEEDS_ATTENTION: 'danger',
  ON_HOLD: 'danger',
};

export function isPrintingAttentionState(state: string): boolean {
  return ['FAILED', 'NEEDS_ATTENTION', 'ON_HOLD'].includes(state);
}

export function layerStatusPresentation(
  _layer: 'payment' | 'printing' | 'fulfillment',
  state: string,
): { label: string; tone: LayerTone } {
  return {
    label: sentenceCase(state),
    tone: tones[state] ?? 'neutral',
  };
}

export function sentenceCase(value: string): string {
  const normalized = value.toLowerCase().replaceAll('_', ' ');
  return normalized ? normalized[0]!.toUpperCase() + normalized.slice(1) : '—';
}

export function formatOrderAddress(address: OrderAddress): string[] {
  return [
    address.recipientName,
    address.line1,
    address.line2,
    [address.city, [address.stateCode, address.postalCode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    countries[address.countryCode] ?? address.countryCode,
  ].filter((line): line is string => Boolean(line));
}

export function groupTimelineByDate<T extends { occurredAt: string }>(
  events: T[],
): Array<{ dateKey: string; events: T[] }> {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const dateKey = new Date(event.occurredAt).toLocaleDateString('en-CA');
    groups.set(dateKey, [...(groups.get(dateKey) ?? []), event]);
  }
  return [...groups].map(([dateKey, groupedEvents]) => ({ dateKey, events: groupedEvents }));
}
