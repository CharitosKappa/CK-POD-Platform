import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as {
      productModelId?: string;
      colorCode?: string;
      expectedRevision?: number;
    };
    const expectedRevision = body.expectedRevision;
    if (
      !body.productModelId ||
      !body.colorCode ||
      expectedRevision === undefined ||
      !Number.isInteger(expectedRevision)
    ) {
      return NextResponse.json({ error: 'Valid selection data is required.' }, { status: 400 });
    }
    const project = await services().projects.selectProduct(
      await requireSession(),
      projectId,
      { productModelId: body.productModelId, colorCode: body.colorCode },
      expectedRevision,
    );
    return NextResponse.json({ project });
  } catch (error) {
    return handleRouteError(error);
  }
}
