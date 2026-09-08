import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';
import { enforceRateLimit } from '../../../../lib/security';
import { normalizeEmail } from '@let-it-be/domain';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await enforceRateLimit(request, {
      action: 'auth-request-code-ip',
      maxRequests: 5,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as { email?: string };
    const email = normalizeEmail(body.email ?? '');
    await enforceRateLimit(request, {
      action: 'auth-request-code-email',
      subject: email,
      maxRequests: 3,
      windowMs: 15 * 60_000,
    });
    await services().identity.requestEmailCode(email);
    await requireSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
