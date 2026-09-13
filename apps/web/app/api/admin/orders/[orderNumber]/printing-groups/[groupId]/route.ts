import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../../lib/http';
import { orderDetailRuntime, requireAdminSession } from '../../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string; groupId: string }> },
) {
  try {
    const { orderNumber, groupId } = await context.params;
    const group = await orderDetailRuntime().getPrintingGroup(
      await requireAdminSession(),
      orderNumber,
      groupId,
    );
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: 'Printing group not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
