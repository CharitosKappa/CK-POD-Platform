import { NextResponse } from 'next/server';

import {
  customerSorts,
  customerViews,
  marketingStatuses,
  type CustomerProfileInput,
  type CustomerSort,
  type CustomerView,
  type MarketingStatus,
} from '@let-it-be/domain';

import { handleRouteError } from '../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

const sorts = new Set<CustomerSort>(customerSorts);
const views = new Set<CustomerView>(customerViews);
const marketing = new Set<MarketingStatus>(marketingStatuses);

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const search = new URL(request.url).searchParams;
    const sort = search.get('sort') ?? undefined;
    const requestedView = search.get('view') ?? undefined;
    const view = requestedView === 'NEW' ? 'RECENTLY_ADDED' : requestedView;
    const emailMarketingStatus = search.get('emailMarketingStatus') ?? undefined;
    const smsMarketingStatus = search.get('smsMarketingStatus') ?? undefined;
    if (sort && !sorts.has(sort as CustomerSort))
      return NextResponse.json({ error: 'Unsupported customer sort.' }, { status: 400 });
    if (view && !views.has(view as CustomerView))
      return NextResponse.json({ error: 'Unsupported customer view.' }, { status: 400 });
    if (emailMarketingStatus && !marketing.has(emailMarketingStatus as MarketingStatus))
      return NextResponse.json({ error: 'Unsupported email marketing status.' }, { status: 400 });
    if (smsMarketingStatus && !marketing.has(smsMarketingStatus as MarketingStatus))
      return NextResponse.json({ error: 'Unsupported SMS marketing status.' }, { status: 400 });
    const result = await customerOperationsRuntime().listCustomers(await requireAdminSession(), {
      ...(search.get('q') ? { query: search.get('q')! } : {}),
      ...(search.get('tag') ? { tag: search.get('tag')! } : {}),
      ...(search.get('location') ? { location: search.get('location')! } : {}),
      ...(sort ? { sort: sort as CustomerSort } : {}),
      ...(view ? { view: view as CustomerView } : {}),
      ...(emailMarketingStatus
        ? { emailMarketingStatus: emailMarketingStatus as MarketingStatus }
        : {}),
      ...(smsMarketingStatus ? { smsMarketingStatus: smsMarketingStatus as MarketingStatus } : {}),
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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CustomerProfileInput;
    const customerId = await customerOperationsRuntime().createCustomer(
      await requireAdminSession(),
      body,
    );
    return NextResponse.json({ customerId }, { status: 201 });
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
