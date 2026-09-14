'use client';

import React, { useEffect, useRef, type ReactNode } from 'react';

export const ADMIN_FEEDBACK_DISMISS_MS = 4_000;

export type AdminFeedbackTone = 'success' | 'info' | 'error';

type FeedbackTimer = ReturnType<typeof setTimeout>;
type FeedbackScheduler = (callback: () => void, delay: number) => FeedbackTimer;
type FeedbackCanceller = (timer: FeedbackTimer) => void;

export function scheduleAdminFeedbackDismiss(
  tone: AdminFeedbackTone,
  onDismiss: () => void,
  schedule: FeedbackScheduler = globalThis.setTimeout,
  cancel: FeedbackCanceller = globalThis.clearTimeout,
): () => void {
  if (tone === 'error') return () => undefined;
  const timer = schedule(onDismiss, ADMIN_FEEDBACK_DISMISS_MS);
  return () => cancel(timer);
}

export function AdminFeedback({
  children,
  tone,
  onDismiss,
}: Readonly<{
  children: ReactNode;
  tone: AdminFeedbackTone;
  onDismiss: () => void;
}>) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(
    () => scheduleAdminFeedbackDismiss(tone, () => dismiss.current()),
    [children, tone],
  );

  return (
    <div className={`admin-feedback is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="admin-feedback-content">{children}</div>
      <button
        aria-label="Dismiss message"
        className="admin-feedback-dismiss"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
