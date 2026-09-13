import { useCallback, useEffect, useState } from 'react';

import { adminApiFetch } from '../../../../lib/admin-api';

import { groupTimelineByDate } from './order-detail-format';
import type { OrderTimelineEvent, OrderTimelinePage } from './order-detail-types';

export function OrderTimeline({
  orderNumber,
  apiBase,
  refreshKey,
}: Readonly<{ orderNumber: string; apiBase: string; refreshKey: number }>) {
  const [events, setEvents] = useState<OrderTimelineEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (requestedPage: number) => {
      setBusy(true);
      setError(undefined);
      try {
        const query = new URLSearchParams({ limit: '10', page: String(requestedPage) });
        const response = await adminApiFetch(
          `${apiBase}/${encodeURIComponent(orderNumber)}/timeline?${query}`,
        );
        const payload = (await response.json()) as OrderTimelinePage & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load the timeline.');
        setEvents(payload.events);
        setPage(payload.page);
        setTotal(payload.total);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load the timeline.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase, orderNumber],
  );

  useEffect(() => {
    void load(1);
  }, [load, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / 10));
  const start = total ? (page - 1) * 10 + 1 : 0;
  const end = Math.min((page - 1) * 10 + events.length, total);

  return (
    <section className="order-timeline-section">
      <h2>Timeline</h2>
      <article className="order-detail-card order-timeline-card" id="order-timeline-events">
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
        {totalPages > 1 ? (
          <nav aria-label="Timeline pagination" className="order-timeline-pagination">
            <button
              aria-controls="order-timeline-events"
              disabled={busy || page === 1}
              onClick={() => void load(page - 1)}
              type="button"
            >
              ← Previous
            </button>
            <span>
              <strong>
                Page {page} of {totalPages}
              </strong>
              <small>
                {start}–{end} of {total}
              </small>
            </span>
            <button
              aria-controls="order-timeline-events"
              disabled={busy || page === totalPages}
              onClick={() => void load(page + 1)}
              type="button"
            >
              Next →
            </button>
          </nav>
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
