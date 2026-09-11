import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      customerIds?: unknown;
      tags?: unknown;
      operation?: unknown;
    };
    if (
      !Array.isArray(body.customerIds) ||
      body.customerIds.some((id) => typeof id !== 'string') ||
      !Array.isArray(body.tags) ||
      body.tags.some((tag) => typeof tag !== 'string') ||
      !['ADD', 'REMOVE'].includes(String(body.operation))
    ) {
      return NextResponse.json({ error: 'Enter a valid bulk tag action.' }, { status: 400 });
    }
    const updated = await customerOperationsRuntime().bulkTags(
      await requireAdminSession(),
      body.customerIds,
      body.tags,
      body.operation as 'ADD' | 'REMOVE',
    );
    return NextResponse.json({ updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
