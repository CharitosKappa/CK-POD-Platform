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
    const draft = await services().projects.getCreationDraft(await requireSession(), projectId);
    if (!draft) return NextResponse.json({ error: 'Project draft not found.' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { expectedRevision?: number; prompt?: string };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return NextResponse.json(
        { error: 'Tell us what you would like on your shirt.' },
        { status: 400 },
      );
    }
    if (prompt.length > 280) {
      return NextResponse.json(
        { error: 'Keep your idea to 280 characters or fewer.' },
        { status: 400 },
      );
    }
    if (!Number.isInteger(body.expectedRevision)) {
      return NextResponse.json(
        { error: 'A current project revision is required.' },
        { status: 400 },
      );
    }
    const { projectId } = await context.params;
    const saved = await services().projects.updateCreationDraft(await requireSession(), projectId, {
      expectedRevision: body.expectedRevision as number,
      prompt,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error);
  }
}
