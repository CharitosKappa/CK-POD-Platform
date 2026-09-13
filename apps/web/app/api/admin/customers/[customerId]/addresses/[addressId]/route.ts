import { NextResponse } from 'next/server';

import type { CustomerAddressMutationInput } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

type AddressContext = {
  params: Promise<{ customerId: string; addressId: string }>;
};

export async function PATCH(request: Request, context: AddressContext): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    const { customerId, addressId } = await context.params;
    const input = (await request.json()) as CustomerAddressMutationInput;
    await customerOperationsRuntime().updateCustomerAddress(session, customerId, addressId, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, context: AddressContext): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    const { customerId, addressId } = await context.params;
    await customerOperationsRuntime().deleteCustomerAddress(session, customerId, addressId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
