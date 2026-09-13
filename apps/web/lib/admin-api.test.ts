import { describe, expect, it, vi } from 'vitest';

import { AdminSessionExpiredError, adminApiFetch, adminSignInPath } from './admin-api';

describe('admin API session handling', () => {
  it('preserves the current admin page in the sign-in return URL', () => {
    expect(adminSignInPath('/admin/orders/%231', '?view=printing')).toBe(
      '/admin/sign-in?returnTo=%2Fadmin%2Forders%2F%25231%3Fview%3Dprinting',
    );
  });

  it('turns an API 401 into one sign-in redirect instead of returning a raw auth error', async () => {
    const onAuthenticationRequired = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));

    await expect(
      adminApiFetch('/api/admin/orders/%231', undefined, {
        fetcher,
        currentLocation: () => ({ pathname: '/admin/orders/%231', search: '' }),
        onAuthenticationRequired,
      }),
    ).rejects.toBeInstanceOf(AdminSessionExpiredError);
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(onAuthenticationRequired).toHaveBeenCalledWith(
      '/admin/sign-in?returnTo=%2Fadmin%2Forders%2F%25231',
    );
  });
});
