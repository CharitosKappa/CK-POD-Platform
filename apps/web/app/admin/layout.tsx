import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { StaffAuthenticationError } from '@let-it-be/domain';

import { requireAdminSession } from '../../lib/platform';
import { AdminSignOutButton } from './admin-sign-out-button';

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  let session;
  try { session = await requireAdminSession(); }
  catch (error) {
    if (error instanceof StaffAuthenticationError) redirect('/admin/sign-in?returnTo=/admin/customers');
    throw error;
  }
  return (
    <div className="ops-admin-shell">
      <aside className="ops-admin-sidebar" aria-label="Admin navigation">
        <Link className="ops-admin-brand" href="/admin/customers"><span>LI</span><strong>LET IT BE</strong></Link>
        <p className="ops-admin-store">Admin · {session.email}</p>
        <nav><p className="ops-admin-nav-label">Store management</p><Link href="/admin/customers" className="ops-admin-nav-link">Customers</Link><p className="ops-admin-nav-label">Operations</p><span className="ops-admin-nav-link is-disabled">Orders</span><span className="ops-admin-nav-link is-disabled">Products & providers</span></nav>
        <AdminSignOutButton />
      </aside>
      <section className="ops-admin-main"><header className="ops-admin-mobile-header"><Link className="ops-admin-mobile-brand" href="/admin/customers">LI</Link><span>Admin</span><Link href="/admin/customers">Customers</Link></header>{children}</section>
    </div>
  );
}
