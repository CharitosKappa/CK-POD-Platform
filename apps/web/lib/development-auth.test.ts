import { describe, expect, it } from 'vitest';

import { localDevelopmentAdminEmail, mayExposeLocalDevelopmentCode } from './development-auth';

describe('mayExposeLocalDevelopmentCode', () => {
  it.each([
    [{ APP_ENV: 'local', NODE_ENV: 'development' }, true],
    [{ APP_ENV: 'local', NODE_ENV: 'test' }, true],
    [{ APP_ENV: 'local', NODE_ENV: 'production' }, false],
    [{ APP_ENV: 'test', NODE_ENV: 'test' }, false],
    [{ APP_ENV: 'staging', NODE_ENV: 'development' }, false],
    [{ APP_ENV: 'production', NODE_ENV: 'production' }, false],
  ] as const)('returns %s for %o', (environment, expected) => {
    expect(mayExposeLocalDevelopmentCode(environment)).toBe(expected);
  });

  it('provides a stable local admin account when no email is configured', () => {
    expect(
      localDevelopmentAdminEmail({
        APP_ENV: 'local',
        NODE_ENV: 'development',
      }),
    ).toBe('admin@letitbe.local');
  });

  it('prefers the configured local admin account', () => {
    expect(
      localDevelopmentAdminEmail({
        APP_ENV: 'local',
        NODE_ENV: 'development',
        INITIAL_ADMIN_EMAIL: ' Owner@Example.com ',
      }),
    ).toBe('owner@example.com');
  });

  it('never exposes or provisions the fallback outside local development', () => {
    expect(
      localDevelopmentAdminEmail({
        APP_ENV: 'production',
        NODE_ENV: 'production',
      }),
    ).toBeUndefined();
  });
});
