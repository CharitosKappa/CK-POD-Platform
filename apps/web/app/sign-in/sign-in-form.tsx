'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Stage = 'EMAIL' | 'CODE' | 'COMPLETE';

interface ApiError {
  error?: string;
}

export function SignInForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('EMAIL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (stage === 'EMAIL') emailRef.current?.focus();
      if (stage === 'CODE') codeRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);

  async function requestCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await request('/api/auth/request-code', { email });
      setStage('CODE');
      setCode('');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (code.length !== 6) {
      setError('Enter the six-digit code to continue.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await request('/api/auth/verify-code', { email, code });
      setStage('COMPLETE');
      window.setTimeout(() => router.replace(returnTo), 550);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function resendCode(): Promise<void> {
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await request('/api/auth/request-code', { email });
      setCode('');
      setNotice('A new code was sent.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSubmitting(false);
    }
  }

  function changeEmail(): void {
    setStage('EMAIL');
    setCode('');
    setError('');
    setNotice('');
  }

  const isEmailStage = stage === 'EMAIL';
  const feedbackId = isEmailStage ? 'signin-email-feedback' : 'signin-code-feedback';

  if (stage === 'COMPLETE') {
    return (
      <section className="auth-account-page auth-sign-in-complete" aria-labelledby="sign-in-title">
        <header className="auth-account-page-header">
          <span aria-hidden="true" />
          <strong>LET IT BE</strong>
          <span aria-hidden="true" />
        </header>
        <div className="auth-account-page-content">
          <p className="auth-account-kicker">Passwordless sign in</p>
          <div className="auth-account-form">
            <h1 id="sign-in-title">You’re signed in.</h1>
            <p>Your design is saved. Taking you back to where you left off…</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Passwordless sign in" className="auth-account-page" onKeyDown={onEscape}>
      <header className="auth-account-page-header">
        <Link aria-label="Back to your design" className="auth-account-back" href={returnTo}>
          <span aria-hidden="true">←</span>
        </Link>
        <strong>LET IT BE</strong>
        <span aria-hidden="true" />
      </header>
      <div className="auth-account-page-content">
        <p className="auth-account-kicker">Passwordless sign in</p>
        {isEmailStage ? (
          <form
            className="auth-account-form"
            noValidate
            onSubmit={(event) => void requestCode(event)}
          >
            <h1 id="sign-in-title">Good to see you.</h1>
            <p>Enter your email and we’ll send a secure sign-in code.</p>
            <label htmlFor="signin-email">Email address</label>
            <input
              aria-describedby={error ? feedbackId : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              enterKeyHint="next"
              id="signin-email"
              inputMode="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              ref={emailRef}
              spellCheck={false}
              type="email"
              value={email}
            />
            {error ? (
              <InlineFeedback id={feedbackId} role="alert" tone="reminder">
                {error}
              </InlineFeedback>
            ) : null}
            <button
              className="auth-create-button auth-account-submit"
              disabled={submitting}
              type="submit"
            >
              {submitting ? 'Sending code…' : 'Continue with email'}{' '}
              <span aria-hidden="true">→</span>
            </button>
            <p className="auth-account-helper">
              New here? We’ll create your passwordless account automatically after you verify your
              email.
            </p>
            <p className="auth-account-legal">
              By continuing, you agree to our <Link href="/terms">Terms &amp; Conditions</Link> and{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </form>
        ) : (
          <form className="auth-account-form" onSubmit={(event) => void verifyCode(event)}>
            <h1 id="sign-in-title">Enter your code.</h1>
            <p>We sent a six-digit code to:</p>
            <button
              className="auth-account-email-change"
              disabled={submitting}
              onClick={changeEmail}
              type="button"
            >
              {email} <span>· Change email</span>
            </button>
            <label htmlFor="signin-code">Verification code</label>
            <div className="auth-otp-field" data-filled={code.length}>
              <div aria-hidden="true" className="auth-otp-slots">
                {Array.from({ length: 6 }, (_, index) => (
                  <span
                    className={[
                      code[index] ? 'is-filled' : '',
                      index === code.length ? 'is-active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={index}
                  >
                    {code[index] ?? ''}
                  </span>
                ))}
              </div>
              <input
                aria-describedby={error ? feedbackId : undefined}
                aria-invalid={error ? true : undefined}
                aria-label="Verification code"
                autoComplete="one-time-code"
                enterKeyHint="done"
                id="signin-code"
                inputMode="numeric"
                maxLength={6}
                name="one-time-code"
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                pattern="[0-9]*"
                ref={codeRef}
                spellCheck={false}
                type="text"
                value={code}
              />
            </div>
            {error ? (
              <InlineFeedback id={feedbackId} role="alert" tone="reminder">
                {error}
              </InlineFeedback>
            ) : null}
            <button
              className="auth-create-button auth-account-submit"
              disabled={submitting}
              type="submit"
            >
              {submitting ? 'Verifying…' : 'Sign in'} <span aria-hidden="true">→</span>
            </button>
            <p className="auth-account-resend">
              Didn’t receive it?{' '}
              <button disabled={submitting} onClick={() => void resendCode()} type="button">
                Resend code
              </button>
            </p>
            {notice ? <InlineFeedback tone="info">{notice}</InlineFeedback> : null}
            <p className="auth-account-helper">The code expires in 10 minutes. Keep it private.</p>
          </form>
        )}
      </div>
    </section>
  );

  function onEscape(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') router.replace(returnTo);
  }
}

function InlineFeedback({
  children,
  id,
  role = 'status',
  tone = 'info',
}: {
  children: string;
  id?: string;
  role?: 'alert' | 'status';
  tone?: 'info' | 'reminder';
}) {
  return (
    <div className={`auth-feedback-inline auth-feedback-tone-${tone}`} id={id} role={role}>
      <span aria-hidden="true" className="auth-feedback-inline-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          <path d="M12 10v5m0-8v.1" />
        </svg>
      </span>
      <span className="auth-feedback-inline-copy">{children}</span>
    </div>
  );
}

async function request(path: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiError;
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong. Please try again.');
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
