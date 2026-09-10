import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    return NextResponse.json({ staff: { email: session.email, role: session.role } });
  } catch (error) {
    return handleRouteError(error);
  }
}
