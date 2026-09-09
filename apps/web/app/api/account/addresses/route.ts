import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ addresses: await services().account.addresses(await requireSession(false)) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return save(request);
}

export async function PATCH(request: Request): Promise<NextResponse> {
  return save(request);
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { id?: string; expectedRevision?: number };
    if (!body.id || !Number.isInteger(body.expectedRevision)) {
      return NextResponse.json({ error: 'A valid saved address is required.' }, { status: 400 });
    }
    await services().account.deleteAddress(await requireSession(false), {
      id: body.id,
      expectedRevision: body.expectedRevision as number,
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function save(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      id?: string;
      expectedRevision?: number;
      recipientName?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      stateCode?: string;
      postalCode?: string;
      countryCode?: string;
      phone?: string | null;
      isDefault?: boolean;
    };
    if (
      typeof body.recipientName !== 'string' ||
      typeof body.line1 !== 'string' ||
      typeof body.city !== 'string' ||
      typeof body.stateCode !== 'string' ||
      typeof body.postalCode !== 'string' ||
      typeof body.countryCode !== 'string'
    ) {
      return NextResponse.json({ error: 'Complete address details are required.' }, { status: 400 });
    }
    const payload = {
      recipientName: body.recipientName,
      line1: body.line1,
      city: body.city,
      stateCode: body.stateCode,
      postalCode: body.postalCode,
      countryCode: body.countryCode,
      ...(body.line2 === undefined ? {} : { line2: body.line2 }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
      ...(body.id ? { id: body.id } : {}),
      ...(body.expectedRevision === undefined ? {} : { expectedRevision: body.expectedRevision }),
    };
    return NextResponse.json({
      address: await services().account.saveAddress(await requireSession(false), payload),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
