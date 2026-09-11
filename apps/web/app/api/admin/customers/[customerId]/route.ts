import { NextResponse } from 'next/server';

import type { CustomerProfileInput } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const { customerId } = await context.params;
    const customer = await customerOperationsRuntime().getCustomer(
      await requireAdminSession(),
      customerId,
    );
    return NextResponse.json({ customer });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const { customerId } = await context.params;
    const body = (await request.json()) as CustomerProfileInput;
    await customerOperationsRuntime().updateCustomer(await requireAdminSession(), customerId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
