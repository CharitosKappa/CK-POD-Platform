import {
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
} from './order-types';

export type OrderListUrlState = Readonly<{
  query: string;
  view: AdminOrderView;
  sort: AdminOrderSort;
  page: number;
  paymentStatus: '' | AdminPaymentStatus;
  printingStatus: '' | AdminPrintingStatus;
  fulfillmentStatus: '' | AdminFulfillmentStatus;
  dateFrom: string;
  dateTo: string;
  minTotal: string;
  maxTotal: string;
  customerId: string;
}>;

export function parseOrderListUrlState(search: URLSearchParams): OrderListUrlState {
  const page = Number(search.get('page') ?? 1);
  return {
    query: search.get('q')?.trim() ?? '',
    view: member(search.get('view'), adminOrderViews) ?? 'ALL',
    sort: member(search.get('sort'), adminOrderSorts) ?? 'DATE_DESC',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    paymentStatus: member(search.get('payment'), adminPaymentStatuses) ?? '',
    printingStatus: member(search.get('printing'), adminPrintingStatuses) ?? '',
    fulfillmentStatus: member(search.get('fulfillment'), adminFulfillmentStatuses) ?? '',
    dateFrom: search.get('from')?.trim() ?? '',
    dateTo: search.get('to')?.trim() ?? '',
    minTotal: search.get('minTotal')?.trim() ?? '',
    maxTotal: search.get('maxTotal')?.trim() ?? '',
    customerId: search.get('customerId')?.trim() ?? '',
  };
}

export function writeOrderListUrlState(state: OrderListUrlState): URLSearchParams {
  const search = new URLSearchParams();
  if (state.query) search.set('q', state.query);
  search.set('view', state.view);
  search.set('sort', state.sort);
  if (state.page > 1) search.set('page', String(state.page));
  if (state.paymentStatus) search.set('payment', state.paymentStatus);
  if (state.printingStatus) search.set('printing', state.printingStatus);
  if (state.fulfillmentStatus) search.set('fulfillment', state.fulfillmentStatus);
  if (state.dateFrom) search.set('from', state.dateFrom);
  if (state.dateTo) search.set('to', state.dateTo);
  if (state.minTotal) search.set('minTotal', state.minTotal);
  if (state.maxTotal) search.set('maxTotal', state.maxTotal);
  if (state.customerId) search.set('customerId', state.customerId);
  return search;
}

function member<const Values extends readonly string[]>(value: string | null, values: Values) {
  return value && values.includes(value) ? (value as Values[number]) : undefined;
}
