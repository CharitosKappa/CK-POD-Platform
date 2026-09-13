import { NextResponse } from 'next/server';

import {
  AdminCommerceValidationError,
  adminFulfillmentStatuses,
  adminOrderSorts,
  adminOrderViews,
  adminPaymentStatuses,
  adminPrintingStatuses,
  type AdminFulfillmentStatus,
  type AdminOrderSort,
  type AdminOrderView,
  type AdminPaymentStatus,
  type AdminPrintingStatus,
} from '@let-it-be/domain';

import { handleRouteError } from '../../../../lib/http';
import { adminCommerceRuntime, requireAdminSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const view = parseEnum(search, 'view', adminOrderViews, 'Unsupported order view.');
    const sort = parseEnum(search, 'sort', adminOrderSorts, 'Unsupported order sort.');
    const paymentStatus = parseEnum(
      search,
      'payment',
      adminPaymentStatuses,
      'Unsupported payment status.',
    );
    const printingStatus = parseEnum(
      search,
      'printing',
      adminPrintingStatuses,
      'Unsupported printing status.',
    );
    const fulfillmentStatus = parseEnum(
      search,
      'fulfillment',
      adminFulfillmentStatuses,
      'Unsupported fulfillment status.',
    );
    const dateFrom = parseDate(search, 'from', 'start');
    const dateTo = parseDate(search, 'to', 'end');
    const minTotalCents = parseMoney(search, 'minTotal', 'minimum');
    const maxTotalCents = parseMoney(search, 'maxTotal', 'maximum');
    if (minTotalCents !== undefined && maxTotalCents !== undefined && minTotalCents > maxTotalCents)
      throw new AdminCommerceValidationError('Minimum total cannot exceed maximum total.');
    return NextResponse.json(
      await adminCommerceRuntime().listOrders(await requireAdminSession(), {
        page: parseInteger(search, 'page') ?? 1,
        limit: parseInteger(search, 'limit') ?? 30,
        ...(search.get('q') ? { query: search.get('q')! } : {}),
        ...(view ? { view: view as AdminOrderView } : {}),
        ...(sort ? { sort: sort as AdminOrderSort } : {}),
        ...(paymentStatus ? { paymentStatus: paymentStatus as AdminPaymentStatus } : {}),
        ...(printingStatus ? { printingStatus: printingStatus as AdminPrintingStatus } : {}),
        ...(fulfillmentStatus
          ? { fulfillmentStatus: fulfillmentStatus as AdminFulfillmentStatus }
          : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(minTotalCents !== undefined ? { minTotalCents } : {}),
        ...(maxTotalCents !== undefined ? { maxTotalCents } : {}),
        ...(search.get('customerId') ? { customerId: search.get('customerId')! } : {}),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

function parseInteger(search: URLSearchParams, key: string) {
  const raw = search.get(key);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new AdminCommerceValidationError(`Invalid ${key}.`);
  return value;
}

function parseEnum<const Values extends readonly string[]>(
  search: URLSearchParams,
  key: string,
  values: Values,
  message: string,
) {
  const value = search.get(key);
  if (!value) return undefined;
  if (!values.includes(value)) throw new AdminCommerceValidationError(message);
  return value as Values[number];
}

function parseDate(search: URLSearchParams, key: string, label: 'start' | 'end') {
  const value = search.get(key);
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new AdminCommerceValidationError(`Enter a valid ${label} date.`);
  return value;
}

function parseMoney(search: URLSearchParams, key: string, label: 'minimum' | 'maximum') {
  const raw = search.get(key);
  if (raw === null || raw === '') return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
    throw new AdminCommerceValidationError(`Enter a valid ${label} total.`);
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new AdminCommerceValidationError(`Enter a valid ${label} total.`);
  return cents;
}
