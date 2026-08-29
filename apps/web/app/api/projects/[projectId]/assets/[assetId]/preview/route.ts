import { NextResponse } from 'next/server';

import { generationRuntime } from '../../../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../../../lib/http';
import { requireSession, services } from '../../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; assetId: string }> },
): Promise<NextResponse> {
  try {
    const { projectId, assetId } = await context.params;
    const preview = await services().assets.getControlledPreview(
      await requireSession(),
      projectId,
      assetId,
    );
    if (!preview) return NextResponse.json({ error: 'Preview not found.' }, { status: 404 });
    const object = await (await generationRuntime()).storage.get(preview.storageKey);
    if (!object) return NextResponse.json({ error: 'Preview not found.' }, { status: 404 });
    const body = Uint8Array.from(object.body).buffer;
    return new NextResponse(body, {
      headers: {
        'content-type': preview.contentType,
        'cache-control': 'private, no-store',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
