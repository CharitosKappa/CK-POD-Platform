import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { clearSessionCookie, requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  try {
    await services().identity.invalidate(await requireSession(false));
  } catch {
    // Logout is idempotent; the browser cookie must be cleared even for an expired session.
  }
  clearSessionCookie(store);
  return NextResponse.json({ ok: true });
}
