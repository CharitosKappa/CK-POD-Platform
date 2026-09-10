import { NextResponse } from 'next/server';

import { normalizeEmail } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/security';
import { staffIdentityRuntime } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await enforceRateLimit(request, {
      action: 'admin-auth-request-code-ip',
      maxRequests: 5,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as { email?: string };
    const email = normalizeEmail(body.email ?? '');
    await enforceRateLimit(request, {
      action: 'admin-auth-request-code-email',
      subject: email,
      maxRequests: 3,
      windowMs: 15 * 60_000,
    });
    await staffIdentityRuntime().requestCode(email);
    // This response intentionally does not reveal whether the address has staff access.
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
