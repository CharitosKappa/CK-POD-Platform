import { NextResponse } from 'next/server';

import { operationalCapability, parseServerEnvironment } from '@let-it-be/config';
import { createLogger, parseLogLevel } from '@let-it-be/observability';

import { generationRuntime } from '../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../lib/http';
import { requireSession } from '../../../../../lib/platform';
import { enforceRateLimit } from '../../../../../lib/security';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const capability = operationalCapability(parseServerEnvironment(process.env), 'GENERATION');
    if (!capability.enabled)
      return NextResponse.json({ error: capability.message }, { status: 503 });
    const body = (await request.json()) as {
      prompt?: string;
      referenceAssetIds?: string[];
    };
    if (typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Describe your idea before generating.' }, { status: 400 });
    }
    const { projectId } = await context.params;
    const session = await requireSession();
    await enforceRateLimit(request, {
      action: 'generation',
      subject: session.userId ?? session.id,
      maxRequests: 10,
      windowMs: 60 * 60_000,
    });
    const { runtime } = await generationRuntime();
    const generation = await runtime.generations.create(session, projectId, {
      rawPrompt: body.prompt,
      ...(Array.isArray(body.referenceAssetIds)
        ? { referenceAssetIds: body.referenceAssetIds }
        : {}),
    });
    createLogger({ service: 'web', minimumLevel: parseLogLevel(process.env.LOG_LEVEL) }).info(
      'generation.request_accepted',
      { requestId: request.headers.get('x-request-id'), projectId, generationId: generation.id },
    );
    return NextResponse.json({ generation }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
