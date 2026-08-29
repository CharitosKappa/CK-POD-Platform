import { NextResponse } from 'next/server';

import { generationRuntime } from '../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../lib/http';
import { requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      prompt?: string;
      referenceAssetIds?: string[];
    };
    if (typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Describe your idea before generating.' }, { status: 400 });
    }
    const { projectId } = await context.params;
    const { runtime } = await generationRuntime();
    const generation = await runtime.generations.create(await requireSession(), projectId, {
      rawPrompt: body.prompt,
      ...(Array.isArray(body.referenceAssetIds)
        ? { referenceAssetIds: body.referenceAssetIds }
        : {}),
    });
    return NextResponse.json({ generation }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
