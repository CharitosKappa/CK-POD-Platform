import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const account = session.userId
      ? await services().identity.getAuthenticatedUser(session.userId)
      : null;
    return NextResponse.json({
      session: { kind: session.kind, userId: session.userId },
      account,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
