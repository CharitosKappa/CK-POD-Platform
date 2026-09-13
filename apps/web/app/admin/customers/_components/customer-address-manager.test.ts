import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomerAddressManagerModal,
  nextDialogFocusIndex,
  restoreDialogFocus,
} from './customer-address-manager';
import type { CustomerDetail } from './customer-types';

const customer = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Maria Example',
  addresses: [
    {
      id: '00000000-0000-4000-8000-000000000077',
      recipientName: 'Maria Example',
      line1: '47 Palm Avenue',
      line2: null,
      city: 'Miami',
      stateCode: 'FL',
      postalCode: '33101',
      countryCode: 'US',
      phone: null,
      isDefault: true,
      source: 'PROFILE',
    },
    {
      id: 'saved:00000000-0000-4000-8000-000000000066',
      recipientName: 'Maria Example',
      line1: '9 Historic Street',
      line2: null,
      city: 'Boston',
      stateCode: 'MA',
      postalCode: '02108',
      countryCode: 'US',
      phone: null,
      isDefault: false,
      source: 'SAVED',
    },
  ],
} as CustomerDetail;

describe('customer address manager', () => {
  it('wraps keyboard focus inside the modal in both directions', () => {
    expect(nextDialogFocusIndex(3, 4, false)).toBe(0);
    expect(nextDialogFocusIndex(0, 4, true)).toBe(3);
    expect(nextDialogFocusIndex(1, 4, false)).toBe(2);
    expect(nextDialogFocusIndex(2, 4, true)).toBe(1);
  });

  it('restores focus to the persistent trigger when the menu item that opened it unmounts', () => {
    const triggerFocus = vi.fn();
    const detachedMenuItemFocus = vi.fn();

    restoreDialogFocus(
      { current: { focus: triggerFocus, isConnected: true } as unknown as HTMLElement },
      { focus: detachedMenuItemFocus, isConnected: false } as unknown as HTMLElement,
    );

    expect(triggerFocus).toHaveBeenCalledOnce();
    expect(detachedMenuItemFocus).not.toHaveBeenCalled();
  });

  it('shows all addresses while keeping historical fallbacks read-only', () => {
    const markup = renderToStaticMarkup(
      createElement(CustomerAddressManagerModal, {
        customer,
        onClose: () => undefined,
        onSaved: async () => undefined,
      }),
    );

    expect(markup).toContain('Manage addresses');
    expect(markup).toContain('Add address');
    expect(markup).toContain('47 Palm Avenue');
    expect(markup).toContain('9 Historic Street');
    expect(markup).toContain('Default');
    expect(markup).toContain('Account address · read only');
    expect(markup).toContain('aria-label="Edit address for Maria Example"');
    expect(markup).not.toContain('aria-label="Edit account address for Maria Example"');
  });
});
