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
    const body = (await request.json()) as {
      expectedRevision?: number;
      generationId?: string;
      transform?: {
        x?: number;
        y?: number;
        scale?: number;
        rotation?: number;
        flipped?: boolean;
      };
    };
    const transform = body.transform;
    if (
      !body.generationId ||
      body.expectedRevision === undefined ||
      !Number.isInteger(body.expectedRevision) ||
      !transform ||
      typeof transform.x !== 'number' ||
      typeof transform.y !== 'number' ||
      typeof transform.scale !== 'number' ||
      typeof transform.rotation !== 'number' ||
      typeof transform.flipped !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'Valid delivered design data is required.' },
        { status: 400 },
      );
    }
    const saved = await services().projects.applyDeliveredGeneration(
      await requireSession(),
      projectId,
      {
        expectedRevision: body.expectedRevision,
        generationId: body.generationId,
        transform: {
          x: transform.x,
          y: transform.y,
          scale: transform.scale,
          rotation: transform.rotation,
          flipped: transform.flipped,
        },
      },
    );
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error);
  }
}
