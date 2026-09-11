import { NextResponse } from 'next/server';

import type { CustomerExportSelection } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { customerExportRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      selection?: CustomerExportSelection;
      customerIds?: string[];
    };
    const selection = body.selection ?? {
      type: 'IDS' as const,
      customerIds: body.customerIds ?? [],
    };
    const result = await (
      await customerExportRuntime()
    ).request(await requireAdminSession(), selection);
    if (result.mode === 'QUEUED') {
      return NextResponse.json(result, { status: 202 });
    }
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
