'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import {
  defaultAdminPreferences,
  readAdminPreferences,
  writeAdminPreferences,
} from '../../lib/admin-preferences';
import { AdminNavigation } from './admin-navigation';
import { AdminSignOutButton } from './admin-sign-out-button';

export function AdminShell({
  children,
  email,
  role,
}: Readonly<{ children: ReactNode; email: string; role: string }>) {
  const [preferences, setPreferences] = useState(defaultAdminPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    setPreferences(readAdminPreferences(window.localStorage));
    setPreferencesReady(true);

    function synchronizePreferences(event: StorageEvent) {
      if (event.storageArea === window.localStorage) {
        setPreferences(readAdminPreferences(window.localStorage));
      }
    }

    window.addEventListener('storage', synchronizePreferences);
    return () => window.removeEventListener('storage', synchronizePreferences);
  }, []);

  function toggleSidebar(): void {
    const next = { ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed };
    setPreferences(next);
    writeAdminPreferences(window.localStorage, next);
  }

  const collapsed = preferences.sidebarCollapsed;
  const roleLabel = role.toLowerCase().replace('_', ' ');

  return (
    <div
      className="commerce-admin"
      data-preferences-ready={preferencesReady}
      data-sidebar-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <aside className="commerce-admin-sidebar">
        <Link className="commerce-admin-brand" href="/admin" aria-label="Let It Be admin home">
          <span className="commerce-admin-brand-wordmark">LET IT BE</span>
          <span className="commerce-admin-brand-monogram" aria-hidden="true">
            L
          </span>
          <small>Store admin</small>
        </Link>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
          className="commerce-admin-sidebar-toggle"
          onClick={toggleSidebar}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d={collapsed ? 'm7 4 6 6-6 6' : 'm13 4-6 6 6 6'} />
          </svg>
        </button>
        <AdminNavigation />
        <div className="commerce-admin-account">
          <span
            aria-label={`${email}, ${roleLabel}`}
            className="commerce-admin-account-avatar"
            data-tooltip={`${email} · ${roleLabel}`}
            role="img"
          >
            {email.slice(0, 1).toUpperCase()}
          </span>
          <div className="commerce-admin-account-copy">
            <strong>{email}</strong>
            <small>{roleLabel}</small>
          </div>
          <AdminSignOutButton />
        </div>
      </aside>
      <section className="commerce-admin-main">
        <header className="commerce-admin-mobile-header">
          <details>
            <summary aria-label="Open admin navigation">☰</summary>
            <div>
              <AdminNavigation />
            </div>
          </details>
          <Link href="/admin">LET IT BE</Link>
          <span>Admin</span>
        </header>
        {children}
      </section>
    </div>
  );
}
