import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await services().fulfillmentAdmin.listProviderMatrix(await requireSession(false));
    return NextResponse.json({ providers: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      qualificationId?: string;
      providerId?: string;
      providerStatus?: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
      qualificationStatus?: 'UNQUALIFIED' | 'UNDER_REVIEW' | 'QUALIFIED' | 'SUSPENDED' | 'REJECTED';
      active?: boolean;
      reliabilityScore?: number;
      routingNotes?: string;
      qualificationNotes?: string;
      g3Reviewed?: boolean;
      physicalTestStatus?: 'NOT_TESTED' | 'PENDING' | 'PASSED' | 'FAILED';
    };
    const session = await requireSession(false);
    const admin = services().fulfillmentAdmin;
    if (body.providerId && body.providerStatus) {
      await admin.setProviderStatus(session, body.providerId, body.providerStatus);
    } else if (body.qualificationId) {
      await admin.updateQualification(session, {
        qualificationId: body.qualificationId,
        ...(body.qualificationStatus ? { qualificationStatus: body.qualificationStatus } : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
        ...(typeof body.reliabilityScore === 'number'
          ? { reliabilityScore: body.reliabilityScore }
          : {}),
        ...(typeof body.routingNotes === 'string' ? { routingNotes: body.routingNotes } : {}),
        ...(typeof body.qualificationNotes === 'string'
          ? { qualificationNotes: body.qualificationNotes }
          : {}),
        ...(typeof body.g3Reviewed === 'boolean' ? { g3Reviewed: body.g3Reviewed } : {}),
        ...(body.physicalTestStatus ? { physicalTestStatus: body.physicalTestStatus } : {}),
      });
    } else {
      return NextResponse.json({ error: 'A provider or candidate is required.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
