import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { normalizeEmail } from '@let-it-be/domain';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services, setSessionCookie } from '../../../../lib/platform';
import { enforceRateLimit } from '../../../../lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await enforceRateLimit(request, {
      action: 'auth-verify-code-ip',
      maxRequests: 12,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as { email?: string; code?: string };
    const email = normalizeEmail(body.email ?? '');
    await enforceRateLimit(request, {
      action: 'auth-verify-code-email',
      subject: email,
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });
    const session = await services().identity.verifyEmailCode(
      await requireSession(),
      email,
      body.code ?? '',
    );
    setSessionCookie(await cookies(), session.token);
    return NextResponse.json({ session: { kind: session.kind, userId: session.userId } });
  } catch (error) {
    return handleRouteError(error);
  }
}
