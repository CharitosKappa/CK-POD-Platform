import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminCustomersClient } from './customers/_components/admin-customers-client';
import { AdminRoleProvider, canManageCustomers } from './admin-role';

describe('admin customer mutation access', () => {
  it('allows owner and operations staff but not read-only staff', () => {
    expect(canManageCustomers('OWNER')).toBe(true);
    expect(canManageCustomers('OPERATIONS')).toBe(true);
    expect(canManageCustomers('READ_ONLY')).toBe(false);
  });

  it('does not expose the customer export surface to read-only staff', () => {
    const readOnly = renderToStaticMarkup(
      createElement(AdminRoleProvider, {
        role: 'READ_ONLY',
        children: createElement(AdminCustomersClient),
      }),
    );
    const owner = renderToStaticMarkup(
      createElement(AdminRoleProvider, {
        role: 'OWNER',
        children: createElement(AdminCustomersClient),
      }),
    );

    expect(readOnly).not.toContain('>Exports<');
    expect(owner).toContain('>Exports<');
  });
});
