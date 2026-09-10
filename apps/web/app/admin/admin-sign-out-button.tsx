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
    <button className="ops-admin-nav-link ops-admin-sign-out" disabled={signingOut} onClick={() => void signOut()} type="button">
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
