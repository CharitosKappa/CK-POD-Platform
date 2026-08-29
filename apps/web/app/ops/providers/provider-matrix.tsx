'use client';

import { useEffect, useState } from 'react';

interface ProviderRow {
  qualificationId: string;
  productName: string;
  providerId: string;
  providerName: string;
  providerStatus: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
  decorationMethod: string;
  qualificationStatus: string;
  active: boolean;
  technicalCompatible: boolean;
  g3Reviewed: boolean;
  physicalTestStatus: string;
  reliabilityScore: number;
  productionProfileId: string | null;
  shippingEnabled: boolean;
  routingNotes: string | null;
}

export function ProviderMatrix() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [message, setMessage] = useState('Loading provider controls…');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const response = await fetch('/api/ops/fulfillment/providers');
      const body = (await response.json()) as { providers?: ProviderRow[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Provider controls are unavailable.');
      setRows(body.providers ?? []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Provider controls are unavailable.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function syncCatalog() {
    setBusy(true);
    setMessage('Refreshing the approved provider catalog…');
    try {
      const response = await fetch('/api/ops/fulfillment/sync', { method: 'POST' });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not refresh the catalog.');
      await load();
      setMessage('Approved catalog data was refreshed. Qualification settings were preserved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh the catalog.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: ProviderRow, providerStatus: ProviderRow['providerStatus']) {
    setBusy(true);
    try {
      const response = await fetch('/api/ops/fulfillment/providers', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: row.providerId, providerStatus }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not update provider availability.');
      await load();
      setMessage(`Updated ${row.providerName}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not update provider availability.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="provider-matrix" aria-labelledby="provider-matrix-title">
      <div className="provider-matrix-heading">
        <div>
          <p className="ops-kicker">Trusted operations</p>
          <h1 id="provider-matrix-title">Provider matrix</h1>
          <p>
            Qualification and test-print approval stay separate from external catalog availability.
          </p>
        </div>
        <button
          className="continue"
          disabled={busy}
          onClick={() => void syncCatalog()}
          type="button"
        >
          Refresh approved catalog
        </button>
      </div>
      {message ? (
        <p className="ops-status" role="status">
          {message}
        </p>
      ) : null}
      {rows.length ? (
        <div className="provider-matrix-list">
          {rows.map((row) => (
            <article className="provider-matrix-row" key={row.qualificationId}>
              <div>
                <p className="ops-label">Product</p>
                <strong>{row.productName}</strong>
                <span>{row.decorationMethod}</span>
              </div>
              <div>
                <p className="ops-label">Provider</p>
                <strong>{row.providerName}</strong>
                <span>{row.providerStatus.toLowerCase()}</span>
              </div>
              <div>
                <p className="ops-label">Qualification</p>
                <strong>{row.qualificationStatus.replace('_', ' ').toLowerCase()}</strong>
                <span>
                  G3: {row.g3Reviewed ? 'reviewed' : 'not reviewed'} · G6:{' '}
                  {row.physicalTestStatus.toLowerCase()}
                </span>
              </div>
              <div>
                <p className="ops-label">Readiness</p>
                <strong>{row.productionProfileId ? 'Profile mapped' : 'Profile needed'}</strong>
                <span>
                  {row.shippingEnabled ? 'Shipping enabled' : 'Shipping unavailable'} · quality{' '}
                  {row.reliabilityScore}/100
                </span>
              </div>
              <div className="provider-matrix-actions">
                <button
                  disabled={busy || row.providerStatus === 'SUSPENDED'}
                  onClick={() => void setStatus(row, 'SUSPENDED')}
                  type="button"
                >
                  Suspend
                </button>
                <button
                  disabled={busy || row.providerStatus === 'ENABLED'}
                  onClick={() => void setStatus(row, 'ENABLED')}
                  type="button"
                >
                  Enable
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
