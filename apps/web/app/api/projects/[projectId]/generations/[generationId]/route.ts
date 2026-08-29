import { NextResponse } from 'next/server';

import { generationRuntime } from '../../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../../lib/http';
import { requireSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; generationId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId, generationId } = await context.params;
    const { runtime } = await generationRuntime();
    const generation = await runtime.generations.get(
      await requireSession(),
      projectId,
      generationId,
    );
    if (!generation) return NextResponse.json({ error: 'Generation not found.' }, { status: 404 });
    return NextResponse.json({ generation });
  } catch (error) {
    return handleRouteError(error);
  }
}
