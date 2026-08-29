import { NextResponse } from 'next/server';

import { generationRuntime } from '../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../lib/http';
import { requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const session = await requireSession();
    const { runtime } = await generationRuntime();
    return NextResponse.json({ prepress: await runtime.prepress.latest(session, projectId) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const session = await requireSession();
    const { runtime } = await generationRuntime();
    return NextResponse.json(
      { prepress: await runtime.prepress.request(session, projectId) },
      { status: 202 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
