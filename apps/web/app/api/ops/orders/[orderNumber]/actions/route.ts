import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { orderOperationsRuntime, requireSession } from '../../../../../../lib/platform';
import { isOperationalReasonCode, type OperationalReasonCode } from '@let-it-be/domain';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireSession(false);
    const operations = await orderOperationsRuntime();
    const { orderNumber } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      stage?: 'PREPRESS' | 'COMPLIANCE';
      outcome?: 'APPROVED' | 'HELD' | 'REJECTED';
      reasonCode?: string;
      notes?: string;
      qualificationId?: string;
    };
    if (body.reasonCode && !isOperationalReasonCode(body.reasonCode)) {
      return NextResponse.json({ error: 'Unsupported operational reason code.' }, { status: 400 });
    }
    const reasonCode = (body.reasonCode ?? 'PRINTABILITY_CONCERN') as OperationalReasonCode;
    if (body.action === 'START_PREPRESS_REVIEW')
      await operations.startPrepressReview(session, orderNumber);
    else if (body.action === 'DECIDE_REVIEW' && body.stage && body.outcome)
      await operations.decideReview(session, {
        orderNumber,
        stage: body.stage,
        outcome: body.outcome,
        reasonCode,
        ...(body.notes ? { notes: body.notes } : {}),
      });
    else if (body.action === 'HOLD')
      await operations.hold(session, orderNumber, reasonCode, body.notes);
    else if (body.action === 'RESUME') await operations.resume(session, orderNumber, body.notes);
    else if (body.action === 'ROUTE') await operations.route(session, orderNumber);
    else if (body.action === 'OVERRIDE_PROVIDER' && body.qualificationId)
      await operations.overrideProvider(session, {
        orderNumber,
        qualificationId: body.qualificationId,
        reasonCode,
        ...(body.notes ? { notes: body.notes } : {}),
      });
    else if (body.action === 'SUBMIT_PRODUCTION') {
      const result = await operations.submitProduction(session, orderNumber);
      return NextResponse.json({ ok: true, result });
    } else return NextResponse.json({ error: 'Unsupported operations action.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
