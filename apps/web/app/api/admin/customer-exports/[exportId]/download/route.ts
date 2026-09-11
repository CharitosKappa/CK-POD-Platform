import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { customerExportRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportId: string }> },
): Promise<NextResponse> {
  try {
    const { exportId } = await context.params;
    const result = await (
      await customerExportRuntime()
    ).download(await requireAdminSession(), exportId);
    return new NextResponse(toReadableStream(result.object.body), {
      headers: {
        'content-type': result.object.contentType,
        'content-disposition': `attachment; filename="${result.export.fileName}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function toReadableStream(source: AsyncIterable<Uint8Array>) {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
