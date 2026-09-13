import type { MarketingStatus } from './customer-types';

export function formatEmailSubscriptionStatus(status: MarketingStatus) {
  if (status === 'SUBSCRIBED') return 'Subscribed';
  if (status === 'NOT_SUBSCRIBED') return 'Not subscribed';
  return 'Unsubscribed';
}

export function emailSubscriptionStatusClass(status: MarketingStatus) {
  if (status === 'SUBSCRIBED') return 'subscribed';
  if (status === 'NOT_SUBSCRIBED') return 'not-subscribed';
  return 'unsubscribed';
}
