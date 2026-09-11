import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { customerIds?: unknown };
    if (!Array.isArray(body.customerIds) || body.customerIds.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'Choose customers to export.' }, { status: 400 });
    }
    const csv = await customerOperationsRuntime().exportCustomers(
      await requireAdminSession(),
      body.customerIds,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="customers-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
