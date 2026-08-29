import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const project = await services().projects.get(await requireSession(), projectId);
    return project
      ? NextResponse.json({ project })
      : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
