import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ profile: await services().account.profile(await requireSession(false)) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      expectedRevision?: number;
    };
    if (
      typeof body.firstName !== 'string' ||
      typeof body.lastName !== 'string' ||
      !Number.isInteger(body.expectedRevision)
    ) {
      return NextResponse.json({ error: 'Valid profile details are required.' }, { status: 400 });
    }
    return NextResponse.json({
      profile: await services().account.updateProfile(await requireSession(false), {
        firstName: body.firstName,
        lastName: body.lastName,
        expectedRevision: body.expectedRevision as number,
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
