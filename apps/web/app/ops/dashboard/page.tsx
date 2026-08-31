'use client';

import { useEffect, useState } from 'react';

type MetricValue = number | null | 'UNAVAILABLE' | 'INCOMPLETE';
type Visibility = Record<string, unknown[]>;

export default function OpsDashboardPage() {
  const [metrics, setMetrics] = useState<Record<string, MetricValue>>({});
  const [visibility, setVisibility] = useState<Visibility>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    void Promise.all(['/api/ops/dashboard', '/api/ops/visibility'].map((path) => fetch(path)))
      .then(async (responses) => {
        const dashboard = responses[0]!;
        const operations = responses[1]!;
        const [dashboardBody, operationsBody] = await Promise.all([
          dashboard.json(),
          operations.json(),
        ]);
        if (!dashboard.ok || !operations.ok)
          throw new Error(
            dashboardBody.error ?? operationsBody.error ?? 'Could not load operations.',
          );
        setMetrics(dashboardBody.metrics);
        setVisibility(operationsBody);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Could not load dashboard.'),
      );
  }, []);
  return (
    <main className="ops-page">
      <section className="ops-review-queue">
        <p className="eyebrow">Operations</p>
        <h1>Business dashboard</h1>
        {error ? (
          <p className="form-error">{error}</p>
        ) : (
          <div className="ops-queue-list">
            {Object.entries(metrics).map(([name, value]) => (
              <p key={name}>
                <strong>{name.replaceAll(/([A-Z])/g, ' $1')}</strong>: {value ?? 'Unavailable'}
              </p>
            ))}
          </div>
        )}
        {!error && (
          <section className="ops-dashboard-visibility" aria-label="Operational queues">
            <p className="ops-label">Operational queues</p>
            <div className="ops-dashboard-queue-grid">
              {(
                [
                  { name: 'Refunds', records: visibility.refunds },
                  { name: 'Reprints', records: visibility.reprints },
                  { name: 'Provider defects', records: visibility.defects },
                  { name: 'Credits', records: visibility.credits },
                  { name: 'Generation failures', records: visibility.generationFailures },
                  { name: 'Async failures', records: visibility.systemFailures },
                  { name: 'Lifecycle failures', records: visibility.lifecycleFailures },
                  { name: 'Customer notes', records: visibility.notes },
                  { name: 'Audit history', records: visibility.audits },
                ] as { name: string; records: unknown[] | undefined }[]
              ).map(({ name, records }) => (
                <p key={name}>
                  <strong>{name}</strong>
                  <span>{Array.isArray(records) ? records.length : 0} recent records</span>
                </p>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
