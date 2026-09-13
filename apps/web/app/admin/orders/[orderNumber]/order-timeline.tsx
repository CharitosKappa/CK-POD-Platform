import { useCallback, useEffect, useState } from 'react';

import { groupTimelineByDate } from './order-detail-format';
import type { OrderTimelineEvent, OrderTimelinePage } from './order-detail-types';

export function OrderTimeline({
  orderNumber,
  apiBase,
  refreshKey,
}: Readonly<{ orderNumber: string; apiBase: string; refreshKey: number }>) {
  const [events, setEvents] = useState<OrderTimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (nextCursor?: string) => {
      setBusy(true);
      setError(undefined);
      try {
        const query = new URLSearchParams({ limit: '10' });
        if (nextCursor) query.set('cursor', nextCursor);
        const response = await fetch(
          `${apiBase}/${encodeURIComponent(orderNumber)}/timeline?${query}`,
        );
        const payload = (await response.json()) as OrderTimelinePage & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load the timeline.');
        setEvents((current) => (nextCursor ? [...current, ...payload.events] : payload.events));
        setCursor(payload.nextCursor);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load the timeline.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, orderNumber],
  );

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="order-timeline-section">
      <h2>Timeline</h2>
      <article className="order-detail-card order-timeline-card">
        {error ? (
          <p className="order-inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {!events.length && busy ? <p className="order-empty-copy">Loading timeline…</p> : null}
        {!events.length && !busy && !error ? (
          <p className="order-empty-copy">No activity recorded.</p>
        ) : null}
        {groupTimelineByDate(events).map((group) => (
          <div key={group.dateKey} className="order-timeline-day">
            <h3>{formatTimelineDate(group.dateKey)}</h3>
            {group.events.map((event) => (
              <div key={event.id} className="order-timeline-event">
                <span aria-hidden="true" />
                <p>
                  <strong>{event.description}</strong>
                  <small>
                    {event.actorName ?? event.source.replaceAll('_', ' ').toLowerCase()}
                  </small>
                </p>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            ))}
          </div>
        ))}
        {cursor ? (
          <button
            className="order-load-more"
            type="button"
            disabled={busy}
            onClick={() => void load(cursor)}
          >
            {busy ? 'Loading…' : 'Load earlier activity'}
          </button>
        ) : null}
      </article>
    </section>
  );
}

function formatTimelineDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
