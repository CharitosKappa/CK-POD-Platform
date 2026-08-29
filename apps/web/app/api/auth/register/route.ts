import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password)
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    const session = await services().identity.register(
      await requireSession(),
      body.email,
      body.password,
    );
    return NextResponse.json(
      { session: { kind: session.kind, userId: session.userId } },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
