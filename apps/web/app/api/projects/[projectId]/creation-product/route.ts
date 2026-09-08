import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

const prototypeSizes = new Set(['s', 'm', 'l', 'xl', '2xl', '3xl', '4xl']);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      expectedRevision?: number;
      productModelId?: string;
      colorCode?: string;
      selectedSize?: string;
    };
    if (
      !Number.isInteger(body.expectedRevision) ||
      !body.productModelId ||
      !body.colorCode ||
      !body.selectedSize ||
      !prototypeSizes.has(body.selectedSize)
    ) {
      return NextResponse.json({ error: 'Choose a valid color and size.' }, { status: 400 });
    }
    const { projectId } = await context.params;
    const saved = await services().projects.updateCreationProduct(
      await requireSession(),
      projectId,
      {
        expectedRevision: body.expectedRevision as number,
        productModelId: body.productModelId,
        colorCode: body.colorCode,
        selectedSize: body.selectedSize,
      },
    );
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error);
  }
}
