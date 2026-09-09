import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { requireSession } from '../../lib/platform';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  try {
    const session = await requireSession(false);
    if (!session.userId) redirect('/sign-in?returnTo=/account');
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication is required.') {
      redirect('/sign-in?returnTo=/account');
    }
    throw error;
  }
  return children;
}
