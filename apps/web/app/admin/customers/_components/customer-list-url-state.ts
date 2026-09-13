import type { CustomerSort, CustomerView, MarketingStatus } from './customer-types';

const views = new Set<CustomerView>([
  'ALL',
  'RECENTLY_ADDED',
  'PROSPECTS',
  'FIRST_TIME',
  'RETURNING',
  'HIGH_VALUE',
  'EMAIL_SUBSCRIBERS',
]);
const sorts = new Set<CustomerSort>([
  'LAST_SEEN_DESC',
  'NAME_ASC',
  'NAME_DESC',
  'EMAIL_ASC',
  'EMAIL_DESC',
  'EMAIL_MARKETING_ASC',
  'EMAIL_MARKETING_DESC',
  'LOCATION_ASC',
  'LOCATION_DESC',
  'ORDER_COUNT_ASC',
  'ORDER_COUNT_DESC',
  'TOTAL_SPENT_ASC',
  'TOTAL_SPENT_DESC',
  'LAST_ORDER_ASC',
  'LAST_ORDER_DESC',
  'TAGS_ASC',
  'TAGS_DESC',
  'CUSTOMER_ADDED_ASC',
  'CUSTOMER_ADDED_DESC',
  'CUSTOMER_UPDATED_ASC',
  'CUSTOMER_UPDATED_DESC',
]);
const subscriptions = new Set<MarketingStatus>(['UNKNOWN', 'NOT_SUBSCRIBED', 'SUBSCRIBED']);

export type CustomerListUrlState = Readonly<{
  query: string;
  view: CustomerView;
  sort: CustomerSort;
  page: number;
  hasOrders: boolean;
  subscription: '' | MarketingStatus;
  location: string;
}>;

export function parseCustomerListUrlState(
  search: URLSearchParams,
  defaults: Readonly<{ view: CustomerView; sort: CustomerSort }>,
): CustomerListUrlState {
  const rawView = search.get('view');
  const rawSort = search.get('sort');
  const rawSubscription = search.get('subscription');
  const rawPage = Number(search.get('page') ?? '1');
  return {
    query: search.get('q')?.trim() ?? '',
    view: rawView && views.has(rawView as CustomerView) ? (rawView as CustomerView) : defaults.view,
    sort: rawSort && sorts.has(rawSort as CustomerSort) ? (rawSort as CustomerSort) : defaults.sort,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    hasOrders: search.get('hasOrders') === '1',
    subscription:
      rawSubscription && subscriptions.has(rawSubscription as MarketingStatus)
        ? (rawSubscription as MarketingStatus)
        : '',
    location: search.get('location')?.trim() ?? '',
  };
}

export function writeCustomerListUrlState(state: CustomerListUrlState): URLSearchParams {
  const search = new URLSearchParams();
  if (state.query) search.set('q', state.query);
  search.set('view', state.view);
  search.set('sort', state.sort);
  if (state.page > 1) search.set('page', String(state.page));
  if (state.hasOrders) search.set('hasOrders', '1');
  if (state.subscription) search.set('subscription', state.subscription);
  if (state.location) search.set('location', state.location);
  return search;
}
