'use client';

import { useState } from 'react';

export function AdminSignOutButton() {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.assign('/admin/sign-in');
  }

  return (
    <button
      className="commerce-admin-sign-out"
      data-tooltip="Sign out"
      disabled={signingOut}
      onClick={() => void signOut()}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M8.5 4H4.8v12h3.7M11 6.5l3.5 3.5-3.5 3.5M7.5 10h7" />
      </svg>
      <span className="commerce-admin-sign-out-label">
        {signingOut ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
