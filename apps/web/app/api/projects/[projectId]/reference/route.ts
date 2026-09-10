import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { ReferenceAssetService, ReferenceAssetValidationError } from '@let-it-be/domain';

import { generationRuntime } from '../../../../../lib/generation-runtime';
import { handleRouteError } from '../../../../../lib/http';
import { databasePool, requireSession } from '../../../../../lib/platform';
import { serverEnvironment } from '../../../../../lib/runtime-environment';
import { enforceRateLimit } from '../../../../../lib/security';

export const dynamic = 'force-dynamic';

const maxUploadBytes = 15 * 1024 * 1024;
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxUploadBytes + 1_048_576) {
      return NextResponse.json({ error: 'Choose an image smaller than 15 MB.' }, { status: 413 });
    }
    const session = await requireSession();
    await enforceRateLimit(request, {
      action: 'reference-upload',
      subject: session.userId ?? session.id,
      maxRequests: 8,
      windowMs: 10 * 60_000,
    });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    }
    const file = form.get('file');
    const expectedRevision = Number(form.get('expectedRevision'));
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    }
    if (!Number.isInteger(expectedRevision)) {
      return NextResponse.json(
        { error: 'A current project revision is required.' },
        { status: 400 },
      );
    }
    if (!acceptedTypes.has(file.type)) {
      return NextResponse.json({ error: 'Choose a PNG, JPEG, or WebP image.' }, { status: 400 });
    }
    if (!file.size || file.size > maxUploadBytes) {
      return NextResponse.json({ error: 'Choose an image smaller than 15 MB.' }, { status: 400 });
    }

    const source = new Uint8Array(await file.arrayBuffer());
    let normalized: { data: Buffer; info: { width: number; height: number } };
    try {
      normalized = await sharp(source, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: 50_000_000,
      })
        .rotate()
        .resize({
          width: 4096,
          height: 4096,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ReferenceAssetValidationError('That image could not be read safely.');
    }

    const { projectId } = await context.params;
    const runtime = await generationRuntime();
    const result = await new ReferenceAssetService(
      databasePool(),
      runtime.storage,
      serverEnvironment().AI_MAX_REFERENCE_ASSETS,
    ).replace(session, projectId, {
      expectedRevision,
      body: normalized.data,
      contentType: 'image/png',
      width: normalized.info.width,
      height: normalized.info.height,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { assetId?: string; expectedRevision?: number };
    if (!body.assetId || !Number.isInteger(body.expectedRevision)) {
      return NextResponse.json(
        { error: 'A reference image and current project revision are required.' },
        { status: 400 },
      );
    }
    const { projectId } = await context.params;
    const runtime = await generationRuntime();
    const result = await new ReferenceAssetService(
      databasePool(),
      runtime.storage,
      serverEnvironment().AI_MAX_REFERENCE_ASSETS,
    ).remove(await requireSession(), projectId, body.assetId, body.expectedRevision as number);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
