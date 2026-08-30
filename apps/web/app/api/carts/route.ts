import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../lib/http';
import { commerceRuntime, requireSession } from '../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { projectId?: string; size?: string; quantity?: number };
    const quantity = body.quantity;
    if (!body.projectId || !body.size || quantity === undefined || !Number.isInteger(quantity)) {
      return NextResponse.json(
        { error: 'Project, size, and quantity are required.' },
        { status: 400 },
      );
    }
    const cart = await (
      await commerceRuntime()
    ).createCart(await requireSession(), {
      projectId: body.projectId,
      size: body.size,
      quantity,
    });
    return NextResponse.json({ cart }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
