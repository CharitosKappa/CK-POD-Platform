import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      selectionMode?: 'MANUAL' | 'AUTO';
      styleFamilyId?: string;
      presetId?: string;
      expectedRevision?: number;
    };
    if (!Number.isInteger(body.expectedRevision)) {
      return NextResponse.json(
        { error: 'A current project revision is required.' },
        { status: 400 },
      );
    }
    const selection =
      body.selectionMode === 'AUTO'
        ? ({ selectionMode: 'AUTO' } as const)
        : body.selectionMode === 'MANUAL' && body.styleFamilyId && body.presetId
          ? ({
              selectionMode: 'MANUAL',
              styleFamilyId: body.styleFamilyId,
              presetId: body.presetId,
            } as const)
          : null;
    if (!selection) {
      return NextResponse.json(
        { error: 'Choose a valid style before continuing.' },
        { status: 400 },
      );
    }
    const { projectId } = await context.params;
    const project = await services().projects.selectGuidedStyle(
      await requireSession(),
      projectId,
      selection,
      body.expectedRevision as number,
    );
    return NextResponse.json({ project });
  } catch (error) {
    return handleRouteError(error);
  }
}
