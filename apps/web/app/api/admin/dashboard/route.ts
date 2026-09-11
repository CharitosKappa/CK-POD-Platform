import { NextResponse } from 'next/server';
import { handleRouteError } from '../../../../lib/http';
import { adminCommerceRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json({
      overview: await adminCommerceRuntime().dashboard(await requireAdminSession()),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
