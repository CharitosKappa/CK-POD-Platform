import { NextResponse } from 'next/server';
import { handleRouteError } from '../../../../lib/http';
import { adminCommerceRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    return NextResponse.json(
      await adminCommerceRuntime().listOrders(await requireAdminSession(), {
        page: Number(search.get('page') ?? 1),
        limit: Number(search.get('limit') ?? 30),
        ...(search.get('q') ? { query: search.get('q')! } : {}),
        ...(search.get('view') ? { view: search.get('view')! } : {}),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
