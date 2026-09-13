import { NextResponse } from 'next/server';

import type { CustomerAddressMutationInput } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    const { customerId } = await context.params;
    const input = (await request.json()) as CustomerAddressMutationInput;
    const addressId = await customerOperationsRuntime().createCustomerAddress(
      session,
      customerId,
      input,
    );
    return NextResponse.json({ addressId }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
