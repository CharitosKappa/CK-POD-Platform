import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { clearAdminSessionCookie, staffIdentityRuntime } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get('let_it_be_admin_session')?.value;
  if (token) await staffIdentityRuntime().revokeSession(token);
  clearAdminSessionCookie(store);
  return NextResponse.json({ ok: true });
}
