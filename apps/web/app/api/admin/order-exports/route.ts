import { NextResponse } from 'next/server';
import { handleRouteError } from '../../../../lib/http';
import { orderExportRuntime, requireAdminSession } from '../../../../lib/platform';
export const dynamic = 'force-dynamic';
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({
      exports: await (await orderExportRuntime()).list(await requireAdminSession()),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
