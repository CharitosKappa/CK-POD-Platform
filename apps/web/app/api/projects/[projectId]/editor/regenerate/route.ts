import { NextResponse } from 'next/server';

import { selectedGeneratedLayer } from '@let-it-be/domain';

import { generationRuntime } from '../../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../../lib/http';
import { requireSession, services } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as { layerId?: string; prompt?: string };
    if (
      typeof body.layerId !== 'string' ||
      typeof body.prompt !== 'string' ||
      !body.prompt.trim()
    ) {
      return NextResponse.json(
        { error: 'Choose artwork and describe the change.' },
        { status: 400 },
      );
    }
    const session = await requireSession();
    const versions = await services().projects.getVersions(session, projectId);
    const active = versions[0];
    if (!active) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const selected = selectedGeneratedLayer(active.editorDocument, body.layerId);
    const { runtime } = await generationRuntime();
    const generation = await runtime.generations.create(session, projectId, {
      rawPrompt: body.prompt.trim(),
      task: 'SELECTED_ELEMENT_EDITING',
      editorMetadata: {
        targetLayerId: selected.id,
        lockedLayerIds: active.editorDocument.layers
          .filter((layer) => layer.locked)
          .map((layer) => layer.id),
      },
    });
    return NextResponse.json({ generation }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
