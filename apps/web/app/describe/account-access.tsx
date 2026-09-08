'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface SessionPayload {
  account: { email: string; id: string } | null;
}

export function AccountAccess({ returnTo }: { returnTo: string }) {
  const [account, setAccount] = useState<SessionPayload['account']>();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session')
      .then(async (response) => {
        const body = (await response.json()) as SessionPayload & { error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Could not load your account.');
        return body.account;
      })
      .then((nextAccount) => {
        if (active) setAccount(nextAccount);
      })
      .catch(() => {
        if (active) setAccount(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout(): Promise<void> {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setAccount(null);
    } finally {
      setLoggingOut(false);
    }
  }

  if (account === undefined) return null;

  if (account) {
    return (
      <section className="account-access" aria-label="Account">
        <p className="account-kicker">Saved to your account</p>
        <div className="account-signed-in">
          <div>
            <strong>{account.email}</strong>
            <span>Your current project is safely connected to your account.</span>
          </div>
          <button
            className="secondary-action"
            disabled={loggingOut}
            onClick={() => void logout()}
            type="button"
          >
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="account-access" aria-labelledby="account-title">
      <p className="account-kicker">Keep it close</p>
      <h2 id="account-title">Save this design for later.</h2>
      <p>Sign in with a one-time code. No password to remember.</p>
      <Link
        className="secondary-action account-sign-in-link"
        href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
      >
        Sign in with email
      </Link>
    </section>
  );
}
