import type { CustomerDetail } from './customer-types';

const day = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type TimelineEntry = CustomerDetail['timeline'][number];

export function CustomerTimeline({ entries }: Readonly<{ entries: CustomerDetail['timeline'] }>) {
  if (!entries.length) return <p className="customer-empty-inline">No customer activity yet.</p>;
  const groups = groupByDay(entries);
  return (
    <div className="customer-timeline customer-detailed-timeline">
      {groups.map((group) => (
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
  );
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
        labelPair('Email', metadata.emailMarketingStatus),
        labelPair('SMS', metadata.smsMarketingStatus),
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
  if (entry.eventType === 'ORDER_PLACED')
    return {
      title: orderNumber ? `Order ${orderNumber} was placed` : 'An order was placed',
      description: joinDetails([
        centsValue(metadata.totalCents),
        statusValue(metadata.status),
        'Online store',
      ]),
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
          : `${amount > 0 ? '+' : ''}${amount} credit${Math.abs(amount) === 1 ? '' : 's'}`,
        numberValue(metadata.balanceAfter) === null
          ? null
          : `Balance ${numberValue(metadata.balanceAfter)}`,
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
function labelPair(label: string, value: unknown) {
  const formatted = statusValue(value);
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
  return ['NOTE', 'LEGACY_NOTE', 'DESIGN_GENERATION'].includes(eventType);
}
