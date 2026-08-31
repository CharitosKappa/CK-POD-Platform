import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { cxOperationsRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return NextResponse.json({
      orders: await cxOperationsRuntime().search(await requireSession(false), query),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const service = cxOperationsRuntime();
    const session = await requireSession(false);
    if (
      body.action === 'REFUND' &&
      typeof body.orderNumber === 'string' &&
      typeof body.amountCents === 'number' &&
      typeof body.reasonCode === 'string' &&
      typeof body.idempotencyKey === 'string'
    )
      return NextResponse.json(
        await service.refund(session, {
          orderNumber: body.orderNumber,
          amountCents: body.amountCents,
          reasonCode: body.reasonCode,
          idempotencyKey: body.idempotencyKey,
          ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
        }),
      );
    if (
      body.action === 'CREATE_REPRINT' &&
      typeof body.orderNumber === 'string' &&
      typeof body.orderItemId === 'string' &&
      typeof body.reasonCode === 'string'
    )
      return NextResponse.json(
        await service.createReprint(session, {
          orderNumber: body.orderNumber,
          orderItemId: body.orderItemId,
          reasonCode: body.reasonCode,
          ...(typeof body.estimatedCostCents === 'number'
            ? { estimatedCostCents: body.estimatedCostCents }
            : {}),
          ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
        }),
      );
    if (
      body.action === 'ADD_NOTE' &&
      typeof body.customerEmail === 'string' &&
      typeof body.note === 'string'
    )
      return NextResponse.json(
        await service.addCustomerNote(session, {
          customerEmail: body.customerEmail,
          body: body.note,
          ...(typeof body.orderNumber === 'string' ? { orderNumber: body.orderNumber } : {}),
        }),
      );
    if (
      body.action === 'APPROVE_REPRINT' &&
      typeof body.reprintId === 'string' &&
      typeof body.approved === 'boolean'
    ) {
      await service.approveReprint(
        session,
        body.reprintId,
        body.approved,
        typeof body.notes === 'string' ? body.notes : undefined,
      );
      return NextResponse.json({ ok: true });
    }
    if (
      body.action === 'PROVIDER_DEFECT' &&
      typeof body.orderNumber === 'string' &&
      typeof body.defectCode === 'string'
    ) {
      await service.recordProviderDefect(session, {
        orderNumber: body.orderNumber,
        defectCode: body.defectCode,
        ...(typeof body.reprintId === 'string' ? { reprintId: body.reprintId } : {}),
        ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported CX action.' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
