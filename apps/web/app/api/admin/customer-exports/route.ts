import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { customerExportRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const exports = await (await customerExportRuntime()).list(await requireAdminSession());
    return NextResponse.json({ exports });
  } catch (error) {
    return handleRouteError(error);
  }
}
