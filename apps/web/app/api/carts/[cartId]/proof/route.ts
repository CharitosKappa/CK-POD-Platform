import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    await (await commerceRuntime()).approveProof(await requireSession(), cartId);
    return NextResponse.json({ approved: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
