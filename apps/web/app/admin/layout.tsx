import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { StaffAuthenticationError } from '@let-it-be/domain';

import { requireAdminSession } from '../../lib/platform';
import { AdminShell } from './admin-shell';

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  let session;
  try {
    session = await requireAdminSession();
  } catch (error) {
    if (error instanceof StaffAuthenticationError) redirect('/admin/sign-in?returnTo=/admin');
    throw error;
  }
  return (
    <AdminShell email={session.email} role={session.role}>
      {children}
    </AdminShell>
  );
}
