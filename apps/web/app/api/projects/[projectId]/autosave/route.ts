import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as { editorDocument?: unknown; expectedRevision?: number };
    const expectedRevision = body.expectedRevision;
    if (
      !body.editorDocument ||
      expectedRevision === undefined ||
      !Number.isInteger(expectedRevision)
    ) {
      return NextResponse.json({ error: 'Valid autosave data is required.' }, { status: 400 });
    }
    const saved = await services().projects.autosave(
      await requireSession(),
      projectId,
      body.editorDocument,
      expectedRevision,
    );
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error);
  }
}
