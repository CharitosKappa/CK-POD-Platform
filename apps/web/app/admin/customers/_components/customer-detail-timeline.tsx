'use client';

import React from 'react';

import type { CustomerDetail } from './customer-types';

const day = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type TimelineEntry = CustomerDetail['timeline'][number];
const timelinePageSize = 10;

export function CustomerTimeline({
  entries,
  error,
  loading = false,
  onPageChange,
  page = 1,
  total = entries.length,
}: Readonly<{
  entries: CustomerDetail['timeline'];
  error?: string;
  loading?: boolean;
  onPageChange?: (page: number) => void;
  page?: number;
  total?: number;
}>) {
  if (!entries.length && !loading)
    return <p className="customer-empty-inline">{error ?? 'No customer activity yet.'}</p>;
  const visiblePage = timelinePage(entries, page, total);
  return (
    <>
      <div
        aria-busy={loading}
        className="customer-timeline customer-detailed-timeline"
        id="customer-timeline-events"
      >
        {visiblePage.groups.map((group) => (
          <section key={group.label}>
            <h3>{group.label}</h3>
            {group.entries.map((entry) => {
              const content = timelineContent(entry);
              return (
                <article key={entry.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{content.title}</strong>
                    {content.description ? <p>{content.description}</p> : null}
                    {entry.body && showsBodyAsDetail(entry.eventType) ? (
                      <blockquote>{entry.body}</blockquote>
                    ) : null}
                    <small>
                      {entry.actorLabel ? `By ${entry.actorLabel}` : 'Automated activity'}
                    </small>
                  </div>
                  <time dateTime={entry.createdAt}>{time.format(new Date(entry.createdAt))}</time>
                </article>
              );
            })}
          </section>
        ))}
      </div>
      {visiblePage.totalPages > 1 ? (
        <nav aria-label="Timeline pagination" className="customer-timeline-pagination">
          <button
            aria-controls="customer-timeline-events"
            disabled={loading || visiblePage.page === 1}
            onClick={() => onPageChange?.(visiblePage.page - 1)}
            type="button"
          >
            ← Previous
          </button>
          <span>
            <strong>
              Page {visiblePage.page} of {visiblePage.totalPages}
            </strong>
            <small>
              {visiblePage.start}–{visiblePage.end} of {visiblePage.total}
            </small>
          </span>
          <button
            aria-controls="customer-timeline-events"
            disabled={loading || visiblePage.page === visiblePage.totalPages}
            onClick={() => onPageChange?.(visiblePage.page + 1)}
            type="button"
          >
            Next →
          </button>
        </nav>
      ) : null}
    </>
  );
}

export function timelinePage(
  entries: CustomerDetail['timeline'],
  requestedPage: number,
  total = entries.length,
) {
  const totalPages = Math.max(1, Math.ceil(total / timelinePageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const startIndex = (page - 1) * timelinePageSize;
  return {
    page,
    totalPages,
    start: total ? startIndex + 1 : 0,
    end: Math.min(startIndex + entries.length, total),
    total,
    groups: groupByDay(entries),
  };
}

export function timelineContent(entry: TimelineEntry): {
  title: string;
  description: string | null;
} {
  const metadata = entry.metadata;
  const orderNumber = textValue(metadata.orderNumber);
  if (entry.eventType === 'NOTE' || entry.eventType === 'LEGACY_NOTE')
    return { title: 'Internal note added', description: null };
  if (entry.eventType === 'PROFILE_CREATED')
    return { title: 'Customer profile created', description: sourceDescription(metadata) };
  if (entry.eventType === 'PROFILE_UPDATED') {
    const changed = listValue(metadata.changedFields);
    return {
      title: 'Customer profile updated',
      description: changed.length ? `Changed ${changed.join(', ')}.` : sourceDescription(metadata),
    };
  }
  if (entry.eventType === 'CONSENT_UPDATED')
    return {
      title: 'Marketing preferences updated',
      description: [
        consentTransition('Email', metadata.email, metadata.emailMarketingStatus),
        consentTransition('SMS', metadata.sms, metadata.smsMarketingStatus),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  if (entry.eventType === 'TAGS_UPDATED') {
    const tags = listValue(metadata.tags);
    return {
      title: 'Customer tags updated',
      description: tags.length ? `Tags: ${tags.join(', ')}.` : 'All customer tags were removed.',
    };
  }
  if (entry.eventType === 'ADDRESS_ADDED' || entry.eventType === 'ADDRESS_UPDATED') {
    const city = textValue(metadata.city);
    const country = textValue(metadata.countryCode);
    return {
      title:
        entry.eventType === 'ADDRESS_ADDED' ? 'Customer address added' : 'Customer address updated',
      description: joinDetails([
        [city, country].filter(Boolean).join(', ') || null,
        metadata.isDefault === true ? 'Set as default' : null,
      ]),
    };
  }
  if (entry.eventType === 'ADDRESS_REMOVED')
    return {
      title: 'Customer address removed',
      description: textValue(metadata.promotedAddressId)
        ? 'Another address was set as default'
        : null,
    };
  if (entry.eventType === 'ORDER_PLACED')
    return {
      title: orderNumber ? `Order ${orderNumber} was placed` : 'An order was placed',
      description: joinDetails([centsValue(metadata.totalCents), statusValue(metadata.status)]),
    };
  if (entry.eventType === 'ORDER_STATUS_CHANGED')
    return {
      title: orderNumber ? `Order ${orderNumber} status changed` : 'Order status changed',
      description: joinDetails([
        transitionValue(metadata.fromState, metadata.toState),
        statusValue(metadata.reasonCode),
        entry.body,
      ]),
    };
  if (entry.eventType === 'REFUND')
    return {
      title: orderNumber ? `Refund recorded for order ${orderNumber}` : 'Refund recorded',
      description: joinDetails([
        centsValue(metadata.amountCents),
        statusValue(metadata.status),
        statusValue(metadata.reasonCode),
        entry.body,
      ]),
    };
  if (entry.eventType === 'REPRINT')
    return {
      title: orderNumber ? `Reprint recorded for order ${orderNumber}` : 'Reprint recorded',
      description: joinDetails([
        statusValue(metadata.status),
        statusValue(metadata.reasonCode),
        centsValue(metadata.estimatedCostCents),
        entry.body,
      ]),
    };
  if (entry.eventType === 'DESIGN_GENERATION')
    return {
      title: 'AI design generation requested',
      description: joinDetails([
        statusValue(metadata.status),
        statusValue(metadata.creditStatus),
        textValue(metadata.failureCategory),
      ]),
    };
  if (entry.eventType === 'CREDIT_LEDGER') {
    const amount = numberValue(metadata.amount);
    return {
      title: `Design credit ${statusValue(metadata.entryType)?.toLowerCase() ?? 'updated'}`,
      description: joinDetails([
        amount === null
          ? null
          : `${amount > 0 ? '+' : ''}${amount} design credit${Math.abs(amount) === 1 ? '' : 's'}`,
        numberValue(metadata.balanceAfter) === null
          ? null
          : `Balance ${numberValue(metadata.balanceAfter)}`,
      ]),
    };
  }
  if (entry.eventType === 'STORE_CREDIT_ADJUSTMENT') {
    const direction = textValue(metadata.direction);
    return {
      title: direction === 'DEBIT' ? 'Store credit deducted' : 'Store credit added',
      description: joinDetails([
        centsValue(metadata.amountCents),
        statusValue(metadata.reason),
        numberValue(metadata.balanceAfterCents) === null
          ? null
          : `Balance ${centsValue(metadata.balanceAfterCents)}`,
      ]),
    };
  }
  if (entry.eventType === 'EMAIL_DELIVERY')
    return {
      title: `${statusValue(metadata.messageType) ?? 'Lifecycle'} email ${statusValue(metadata.status)?.toLowerCase() ?? 'updated'}`,
      description: joinDetails([
        statusValue(metadata.classification),
        orderNumber ? `Order ${orderNumber}` : null,
      ]),
    };
  return { title: humanize(entry.eventType), description: entry.body };
}

function groupByDay(entries: CustomerDetail['timeline']) {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const label = day.format(new Date(entry.createdAt));
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return Array.from(groups, ([label, groupedEntries]) => ({ label, entries: groupedEntries }));
}

function sourceDescription(metadata: Record<string, unknown>) {
  const source = textValue(metadata.source);
  return source ? `Source: ${humanize(source)}.` : null;
}
function consentTransition(label: string, value: unknown, legacyValue: unknown) {
  const transition = recordValue(value);
  const formatted = transition
    ? transitionValue(transition.previousStatus, transition.newStatus)
    : statusValue(legacyValue);
  return formatted ? `${label}: ${formatted}` : null;
}
function transitionValue(from: unknown, to: unknown) {
  const previous = statusValue(from);
  const next = statusValue(to);
  if (previous && next) return `${previous} → ${next}`;
  return next;
}
function centsValue(value: unknown) {
  const cents = numberValue(value);
  return cents === null ? null : money.format(cents / 100);
}
function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function listValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function statusValue(value: unknown) {
  const text = textValue(value);
  return text ? humanize(text) : null;
}
function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
function joinDetails(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(' · ') || null;
}
function showsBodyAsDetail(eventType: string) {
  return ['NOTE', 'LEGACY_NOTE', 'DESIGN_GENERATION', 'STORE_CREDIT_ADJUSTMENT'].includes(
    eventType,
  );
}
