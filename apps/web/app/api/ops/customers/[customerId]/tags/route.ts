import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { customerOperationsRuntime, requireSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { tags?: unknown };
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string'))
      return NextResponse.json({ error: 'Enter valid customer tags.' }, { status: 400 });
    const { customerId } = await context.params;
    const tags = await customerOperationsRuntime().replaceTags(
      await requireSession(false),
      customerId,
      body.tags,
    );
    return NextResponse.json({ tags });
  } catch (error) {
    return handleRouteError(error);
  }
}
