import { NextResponse } from 'next/server';

import { type CustomerSort } from '@let-it-be/domain';

import { handleRouteError } from '../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

const sorts = new Set<CustomerSort>([
  'LAST_SEEN_DESC',
  'TOTAL_SPENT_DESC',
  'ORDER_COUNT_DESC',
  'NAME_ASC',
]);

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const search = new URL(request.url).searchParams;
    const sort = search.get('sort') ?? undefined;
    if (sort && !sorts.has(sort as CustomerSort))
      return NextResponse.json({ error: 'Unsupported customer sort.' }, { status: 400 });
    const result = await customerOperationsRuntime().listCustomers(await requireAdminSession(), {
      ...(search.get('q') ? { query: search.get('q')! } : {}),
      ...(search.get('tag') ? { tag: search.get('tag')! } : {}),
      ...(sort ? { sort: sort as CustomerSort } : {}),
      ...parseInteger(search, 'page'),
      ...parseInteger(search, 'limit'),
      ...parseInteger(search, 'minOrders'),
      ...parseInteger(search, 'minSpentCents'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

function parseInteger(search: URLSearchParams, key: string): Record<string, number> {
  const value = search.get(key);
  if (!value) return {};
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${key}.`);
  return { [key]: parsed };
}
