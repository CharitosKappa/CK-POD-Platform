'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Stage = 'EMAIL' | 'CODE' | 'COMPLETE';
type ApiError = { error?: string };

export function AdminSignInForm({ returnTo }: Readonly<{ returnTo: string }>) {
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
    setSubmitting(true); setError(''); setNotice('');
    try {
      await request('/api/admin/auth/request-code', { email });
      setCode(''); setStage('CODE');
    } catch (reason) { setError(messageFor(reason)); }
    finally { setSubmitting(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (code.length !== 6) { setError('Enter the six-digit code to continue.'); return; }
    setSubmitting(true); setError(''); setNotice('');
    try {
      await request('/api/admin/auth/verify-code', { email, code });
      setStage('COMPLETE');
      window.setTimeout(() => router.replace(returnTo), 450);
    } catch (reason) { setError(messageFor(reason)); }
    finally { setSubmitting(false); }
  }

  async function resend(): Promise<void> {
    setSubmitting(true); setError(''); setNotice('');
    try { await request('/api/admin/auth/request-code', { email }); setCode(''); setNotice('A new code was sent.'); }
    catch (reason) { setError(messageFor(reason)); }
    finally { setSubmitting(false); }
  }

  if (stage === 'COMPLETE') return (
    <section className="auth-account-page auth-sign-in-complete" aria-labelledby="admin-sign-in-title">
      <header className="auth-account-page-header"><span aria-hidden="true" /><strong>LET IT BE</strong><span aria-hidden="true" /></header>
      <div className="auth-account-page-content"><p className="auth-account-kicker">Staff access</p><div className="auth-account-form"><h1 id="admin-sign-in-title">You’re signed in.</h1><p>Opening the admin workspace…</p></div></div>
    </section>
  );

  return (
    <section aria-label="Staff sign in" className="auth-account-page">
      <header className="auth-account-page-header"><span aria-hidden="true" /><strong>LET IT BE</strong><span aria-hidden="true" /></header>
      <div className="auth-account-page-content">
        <p className="auth-account-kicker">Staff access</p>
        {stage === 'EMAIL' ? (
          <form className="auth-account-form" noValidate onSubmit={(event) => void requestCode(event)}>
            <h1 id="admin-sign-in-title">Sign in to admin.</h1>
            <p>Use your invited work email to receive a secure sign-in code.</p>
            <label htmlFor="admin-email">Email address</label>
            <input aria-describedby={error ? 'admin-feedback' : undefined} aria-invalid={error ? true : undefined} autoComplete="email" enterKeyHint="next" id="admin-email" inputMode="email" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" ref={emailRef} spellCheck={false} type="email" value={email} />
            {error ? <Feedback>{error}</Feedback> : null}
            <button className="auth-create-button auth-account-submit" disabled={submitting} type="submit">{submitting ? 'Sending code…' : 'Continue with email'} <span aria-hidden="true">→</span></button>
            <p className="auth-account-helper">Access is limited to invited staff members.</p>
          </form>
        ) : (
          <form className="auth-account-form" onSubmit={(event) => void verifyCode(event)}>
            <h1 id="admin-sign-in-title">Enter your code.</h1>
            <p>We sent a six-digit code to:</p>
            <button className="auth-account-email-change" disabled={submitting} onClick={() => { setStage('EMAIL'); setCode(''); setError(''); setNotice(''); }} type="button">{email} <span>· Change email</span></button>
            <label htmlFor="admin-code">Verification code</label>
            <div className="auth-otp-field" data-filled={code.length}>
              <div aria-hidden="true" className="auth-otp-slots">{Array.from({ length: 6 }, (_, index) => <span className={[code[index] ? 'is-filled' : '', index === code.length ? 'is-active' : ''].filter(Boolean).join(' ')} key={index}>{code[index] ?? ''}</span>)}</div>
              <input aria-describedby={error ? 'admin-feedback' : undefined} aria-invalid={error ? true : undefined} aria-label="Verification code" autoComplete="one-time-code" enterKeyHint="done" id="admin-code" inputMode="numeric" maxLength={6} name="one-time-code" onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} pattern="[0-9]*" ref={codeRef} spellCheck={false} type="text" value={code} />
            </div>
            {error ? <Feedback>{error}</Feedback> : null}
            <button className="auth-create-button auth-account-submit" disabled={submitting} type="submit">{submitting ? 'Verifying…' : 'Sign in'} <span aria-hidden="true">→</span></button>
            <p className="auth-account-resend">Didn’t receive it? <button disabled={submitting} onClick={() => void resend()} type="button">Resend code</button></p>
            {notice ? <p className="auth-feedback-inline auth-feedback-tone-info" role="status">{notice}</p> : null}
            <p className="auth-account-helper">The code expires in 10 minutes. Keep it private.</p>
          </form>
        )}
      </div>
    </section>
  );
}

function Feedback({ children }: Readonly<{ children: string }>) { return <p className="auth-feedback-inline auth-feedback-tone-reminder" id="admin-feedback" role="alert">{children}</p>; }
async function request(path: string, body: Record<string, string>): Promise<void> { const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const payload = await response.json() as ApiError; if (!response.ok) throw new Error(payload.error ?? 'Something went wrong. Please try again.'); }
function messageFor(reason: unknown): string { return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'; }
