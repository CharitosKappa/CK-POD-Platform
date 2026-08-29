import { NextResponse } from 'next/server';

import { StyleCatalogService } from '@let-it-be/domain';

import { handleRouteError } from '../../../lib/http';
import { services } from '../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const styles = await new StyleCatalogService(services().pool).listActive();
    return NextResponse.json({ styles });
  } catch (error) {
    return handleRouteError(error);
  }
}
