import { describe, expect, it } from 'vitest';

import {
  addressDraftFrom,
  addressUpdatePayload,
  contactDraftFrom,
  contactUpdatePayload,
} from './customer-detail-editing';
import type { CustomerDetail } from './customer-types';

const customer = {
  firstName: 'Taylor',
  lastName: 'Example',
  email: 'taylor@example.test',
  phone: '+1 415 555 1000',
  emailMarketingStatus: 'SUBSCRIBED',
  smsMarketingStatus: 'NOT_SUBSCRIBED',
  addresses: [
    {
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
      address: { line1: '100 Main Street', city: 'San Francisco', countryCode: 'US' },
    });
  });

  it('preserves profile and consent fields when the address is edited', () => {
    const address = { ...addressDraftFrom(customer), city: 'Oakland' };

    expect(addressUpdatePayload(customer, address)).toMatchObject({
      firstName: 'Taylor',
      email: 'taylor@example.test',
      emailMarketingStatus: 'SUBSCRIBED',
      address: { city: 'Oakland' },
    });
  });
});
