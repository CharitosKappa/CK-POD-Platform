import { describe, expect, it } from 'vitest';

import { contactDraftFrom, contactUpdatePayload } from './customer-detail-editing';
import type { CustomerDetail } from './customer-types';

const customer = {
  firstName: 'Taylor',
  lastName: 'Example',
  email: 'taylor@example.test',
  phone: '+1 415 555 1000',
  emailMarketingStatus: 'SUBSCRIBED',
  smsMarketingStatus: 'NOT_SUBSCRIBED',
  preferredLocale: 'en',
  preferredLocaleSource: 'BROWSER',
  addresses: [
    {
      recipientName: 'Taylor Example',
      phone: '+1 415 555 1000',
      countryCode: 'US',
      line1: '100 Main Street',
      line2: null,
      city: 'San Francisco',
      stateCode: 'CA',
      postalCode: '94107',
    },
  ],
} as CustomerDetail;

describe('customer detail modal payloads', () => {
  it('preserves the address when contact details are edited', () => {
    const draft = { ...contactDraftFrom(customer), phone: '+1 415 555 2000' };

    expect(contactUpdatePayload(customer, draft)).toMatchObject({
      phone: '+1 415 555 2000',
      preferredLocale: 'en',
      address: {
        recipientName: 'Taylor Example',
        phone: '+1 415 555 1000',
        line1: '100 Main Street',
        city: 'San Francisco',
        countryCode: 'US',
      },
    });
  });
});
