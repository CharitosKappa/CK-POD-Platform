import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../lib/http';
import { requireSession, services } from '../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { productModelId?: string; colorCode?: string };
    if (!body.productModelId || !body.colorCode) {
      return NextResponse.json({ error: 'A product and color are required.' }, { status: 400 });
    }
    const session = await requireSession();
    const project = await services().projects.create(session, {
      productModelId: body.productModelId,
      colorCode: body.colorCode,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
