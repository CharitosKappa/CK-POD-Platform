import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const tags = await customerOperationsRuntime().listTags(await requireAdminSession());
    return NextResponse.json({ tags });
  } catch (error) {
    return handleRouteError(error);
  }
}
