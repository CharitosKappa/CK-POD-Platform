import type { ReactNode } from 'react';

export type FeedbackTone = 'info' | 'success' | 'reminder' | 'warning' | 'error';

export function FeedbackIcon({ tone }: { tone: FeedbackTone }) {
  if (tone === 'success') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m6.5 12.5 3.4 3.4 7.6-8" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 4.6 20 19H4L12 4.6Z" />
        <path d="M12 9v4.4M12 16.6v.1" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z" />
        <path d="m9.3 9.3 5.4 5.4m0-5.4-5.4 5.4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      <path d="M12 10v5m0-8v.1" />
    </svg>
  );
}

export function InlineFeedback({
  children,
  className = '',
  id,
  role = 'status',
  tone,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  role?: 'alert' | 'status';
  tone: FeedbackTone;
}) {
  return (
    <div
      className={`feedback-inline feedback-tone-${tone} ${className}`.trim()}
      id={id}
      role={role}
    >
      <span aria-hidden="true" className="feedback-inline-icon">
        <FeedbackIcon tone={tone} />
      </span>
      <span className="feedback-inline-copy">{children}</span>
    </div>
  );
}
