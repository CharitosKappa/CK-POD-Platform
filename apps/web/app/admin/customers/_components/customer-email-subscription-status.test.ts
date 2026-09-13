import { describe, expect, it } from 'vitest';

import {
  emailSubscriptionStatusClass,
  formatEmailSubscriptionStatus,
} from './customer-email-subscription-status';

describe('formatEmailSubscriptionStatus', () => {
  it('distinguishes customers who never opted in from customers who opted out', () => {
    expect(formatEmailSubscriptionStatus('SUBSCRIBED')).toBe('Subscribed');
    expect(formatEmailSubscriptionStatus('NOT_SUBSCRIBED')).toBe('Not subscribed');
    expect(formatEmailSubscriptionStatus('UNSUBSCRIBED')).toBe('Unsubscribed');
  });
});

describe('emailSubscriptionStatusClass', () => {
  it.each([
    ['SUBSCRIBED', 'subscribed'],
    ['NOT_SUBSCRIBED', 'not-subscribed'],
    ['UNSUBSCRIBED', 'unsubscribed'],
  ] as const)('maps %s to its semantic dot style', (status, expectedClass) => {
    expect(emailSubscriptionStatusClass(status)).toBe(expectedClass);
  });
});
