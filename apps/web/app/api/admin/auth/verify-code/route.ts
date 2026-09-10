import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { normalizeEmail } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/security';
import { setAdminSessionCookie, staffIdentityRuntime } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await enforceRateLimit(request, {
      action: 'admin-auth-verify-code-ip',
      maxRequests: 12,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as { email?: string; code?: string };
    const email = normalizeEmail(body.email ?? '');
    await enforceRateLimit(request, {
      action: 'admin-auth-verify-code-email',
      subject: email,
      maxRequests: 8,
      windowMs: 15 * 60_000,
    });
    const session = await staffIdentityRuntime().verifyCode(email, body.code ?? '');
    setAdminSessionCookie(await cookies(), session.token);
    return NextResponse.json({ staff: { email: session.email, role: session.role } });
  } catch (error) {
    return handleRouteError(error);
  }
}
