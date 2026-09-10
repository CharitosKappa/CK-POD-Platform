'use client';

import { useEffect, useState } from 'react';

export type OperationsDialog =
  { kind: 'review'; stage: 'PREPRESS' | 'COMPLIANCE' } | { kind: 'hold' } | { kind: 'resume' };

type DialogSubmission = { action: string; payload: Record<string, string> };

const reasonOptions = {
  PREPRESS: [
    'PRINTABILITY_CONCERN',
    'LOW_RESOLUTION',
    'INVALID_PLACEMENT',
    'TRANSPARENCY_ISSUE',
    'BACKGROUND_ISSUE',
    'FONT_RENDERING_ISSUE',
  ],
  COMPLIANCE: [
    'MODERATION_REVIEW',
    'IP_REVIEW',
    'COPYRIGHT_CHARACTER',
    'FAN_ART',
    'BRAND_LOGO',
    'TRADEMARK_RISK',
    'POLICY_UNCERTAIN',
  ],
  HOLD: [
    'OPERATIONAL_HOLD',
    'PROVIDER_UNAVAILABLE',
    'VARIANT_UNAVAILABLE',
    'SHIPPING_UNAVAILABLE',
    'PRINTIFY_ERROR',
  ],
} as const;

function readable(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ');
}

export function OperationsActionDialog({
  dialog,
  busy,
  onClose,
  onSubmit,
}: Readonly<{
  dialog: OperationsDialog;
  busy: boolean;
  onClose: () => void;
  onSubmit: (submission: DialogSubmission) => void;
}>) {
  const reviewStage = dialog.kind === 'review' ? dialog.stage : null;
  const [outcome, setOutcome] = useState<'APPROVED' | 'HELD' | 'REJECTED'>('APPROVED');
  const [reasonCode, setReasonCode] = useState(
    reviewStage === 'COMPLIANCE' ? 'MODERATION_REVIEW' : 'PRINTABILITY_CONCERN',
  );
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setOutcome('APPROVED');
    setReasonCode(
      dialog.kind === 'review' && dialog.stage === 'COMPLIANCE'
        ? 'MODERATION_REVIEW'
        : dialog.kind === 'hold'
          ? 'OPERATIONAL_HOLD'
          : 'PRINTABILITY_CONCERN',
    );
    setNotes('');
  }, [dialog]);

  const title =
    dialog.kind === 'review'
      ? `${dialog.stage === 'PREPRESS' ? 'Prepress' : 'Compliance'} review`
      : dialog.kind === 'hold'
        ? 'Place order on hold'
        : 'Resume order';
  const reasons =
    dialog.kind === 'review'
      ? reasonOptions[dialog.stage]
      : dialog.kind === 'hold'
        ? reasonOptions.HOLD
        : [];
  const submitLabel =
    dialog.kind === 'review'
      ? outcome === 'APPROVED'
        ? 'Approve review'
        : outcome === 'HELD'
          ? 'Place on hold'
          : 'Reject order'
      : dialog.kind === 'hold'
        ? 'Place on hold'
        : 'Resume order';

  return (
    <div className="ops-action-modal-backdrop" role="presentation">
      <section
        className="ops-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-action-title"
      >
        <header>
          <div>
            <p>Order action</p>
            <h2 id="ops-action-title">{title}</h2>
          </div>
          <button
            type="button"
            className="ops-action-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog.kind === 'review') {
              onSubmit({
                action: 'DECIDE_REVIEW',
                payload: {
                  stage: dialog.stage,
                  outcome,
                  reasonCode,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
              });
              return;
            }
            if (dialog.kind === 'hold') {
              onSubmit({
                action: 'HOLD',
                payload: { reasonCode, ...(notes.trim() ? { notes: notes.trim() } : {}) },
              });
              return;
            }
            onSubmit({ action: 'RESUME', payload: notes.trim() ? { notes: notes.trim() } : {} });
          }}
        >
          {dialog.kind === 'review' ? (
            <label>
              Decision
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as typeof outcome)}
              >
                <option value="APPROVED">Approve</option>
                <option value="HELD">Place on hold</option>
                <option value="REJECTED">Reject</option>
              </select>
            </label>
          ) : null}
          {reasons.length ? (
            <label>
              Reason
              <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                {reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {readable(reason)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Internal note <span>Optional</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
          </label>
          <footer>
            <button type="button" className="ops-admin-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ops-admin-primary" disabled={busy}>
              {busy ? 'Saving…' : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
