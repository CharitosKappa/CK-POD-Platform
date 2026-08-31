import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services, setSessionCookie } from '../../../../lib/platform';
import { enforceRateLimit } from '../../../../lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await enforceRateLimit(request, {
      action: 'auth-login',
      maxRequests: 5,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password)
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    const session = await services().identity.login(
      await requireSession(),
      body.email,
      body.password,
    );
    setSessionCookie(await cookies(), session.token);
    return NextResponse.json({ session: { kind: session.kind, userId: session.userId } });
  } catch (error) {
    return handleRouteError(error);
  }
}
