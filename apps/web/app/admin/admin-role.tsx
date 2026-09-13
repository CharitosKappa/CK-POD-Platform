'use client';

import React, { createContext, useContext, type ReactNode } from 'react';

export type AdminRole = 'OWNER' | 'OPERATIONS' | 'READ_ONLY';

const AdminRoleContext = createContext<AdminRole>('READ_ONLY');

export function AdminRoleProvider({
  children,
  role,
}: Readonly<{ children: ReactNode; role: string }>) {
  const safeRole: AdminRole = ['OWNER', 'OPERATIONS'].includes(role)
    ? (role as AdminRole)
    : 'READ_ONLY';
  return <AdminRoleContext.Provider value={safeRole}>{children}</AdminRoleContext.Provider>;
}

export function useAdminRole() {
  return useContext(AdminRoleContext);
}

export function canManageCustomers(role: string) {
  return role === 'OWNER' || role === 'OPERATIONS';
}

export function canManageOrders(role: string) {
  return role === 'OWNER' || role === 'OPERATIONS';
}
