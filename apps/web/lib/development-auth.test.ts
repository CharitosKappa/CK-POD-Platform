import { describe, expect, it } from 'vitest';

import { mayExposeLocalDevelopmentCode } from './development-auth';

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
});
