import { NextResponse } from 'next/server';

import { prototypeStyleIds, prototypeToneIds } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      expectedRevision?: number;
      prototypeStyleId?: string;
      prototypeToneId?: string;
    };
    if (
      !Number.isInteger(body.expectedRevision) ||
      !prototypeStyleIds.includes(body.prototypeStyleId as (typeof prototypeStyleIds)[number]) ||
      !prototypeToneIds.includes(body.prototypeToneId as (typeof prototypeToneIds)[number])
    ) {
      return NextResponse.json({ error: 'Choose a valid style and tone.' }, { status: 400 });
    }
    const { projectId } = await context.params;
    const saved = await services().projects.updateCreationStyle(await requireSession(), projectId, {
      expectedRevision: body.expectedRevision as number,
      prototypeStyleId: body.prototypeStyleId as string,
      prototypeToneId: body.prototypeToneId as string,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error);
  }
}
