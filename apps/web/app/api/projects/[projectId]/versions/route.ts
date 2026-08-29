import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    return NextResponse.json({
      versions: await services().projects.getVersions(await requireSession(), projectId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
