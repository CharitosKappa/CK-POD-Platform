import { NextResponse } from 'next/server';
import type { OrderExportSelection } from '@let-it-be/domain';
import { handleRouteError } from '../../../../../lib/http';
import { orderExportRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { selection?: OrderExportSelection };
    const result = await (
      await orderExportRuntime()
    ).request(await requireAdminSession(), body.selection as OrderExportSelection);
    if (result.mode === 'QUEUED') return NextResponse.json(result, { status: 202 });
    return new NextResponse(new TextDecoder().decode(result.body), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${result.fileName}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
