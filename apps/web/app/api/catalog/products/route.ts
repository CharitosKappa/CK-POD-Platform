import { NextResponse } from 'next/server';

import { ProductCatalogService } from '@let-it-be/domain';

import { handleRouteError } from '../../../../lib/http';
import { services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const catalog = new ProductCatalogService(services().pool);
    return NextResponse.json({ products: await catalog.listActiveProducts() });
  } catch (error) {
    return handleRouteError(error);
  }
}
