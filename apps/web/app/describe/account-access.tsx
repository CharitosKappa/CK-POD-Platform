'use client';

import { useState, type FormEvent } from 'react';

export function AccountAccess() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setStatus(undefined);
    try {
      const response = await fetch(isSignIn ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not update your account.');
      setStatus(
        isSignIn
          ? 'You are signed in. This project is now saved to your account.'
          : 'Your account is ready. This project is now saved to it.',
      );
      setPassword('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update your account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="account-access" aria-labelledby="account-title">
      <h2 id="account-title">{isSignIn ? 'Sign in to save this project' : 'Save this project'}</h2>
      <p>
        {isSignIn
          ? 'Sign in to add this guest project to your account.'
          : 'Create an account to keep this project and its future history.'}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Email
          <input
            autoComplete="email"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          Password
          <input
            autoComplete={isSignIn ? 'current-password' : 'new-password'}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <button className="continue" disabled={submitting} type="submit">
          {submitting
            ? isSignIn
              ? 'Signing in…'
              : 'Creating account…'
            : isSignIn
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
      {status ? (
        <p className="status" role="status">
          {status}
        </p>
      ) : null}
      <button
        className="secondary-action"
        onClick={() => {
          setIsSignIn((value) => !value);
          setStatus(undefined);
        }}
        type="button"
      >
        {isSignIn ? 'Create a new account instead' : 'Already have an account? Sign in'}
      </button>
    </section>
  );
}
