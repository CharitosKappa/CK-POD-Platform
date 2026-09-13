import { describe, expect, it } from 'vitest';

import {
  integrationTestDatabaseUrl,
  resolveIntegrationDatabaseUrls,
} from './integration-test-database';

describe('integration test database resolution', () => {
  it('requires the isolated-runner flag before exposing a database URL to test suites', () => {
    expect(
      integrationTestDatabaseUrl({
        DATABASE_URL: 'postgresql://developer:secret@db.example.com/app',
      }),
    ).toBeUndefined();
    expect(
      integrationTestDatabaseUrl({
        DATABASE_URL: 'postgresql://developer:secret@db.example.com/app_test',
        INTEGRATION_TEST_DATABASE: '1',
      }),
    ).toBe('postgresql://developer:secret@db.example.com/app_test');
  });

  it('derives an isolated test database from the development URL', () => {
    expect(
      resolveIntegrationDatabaseUrls({
        DATABASE_URL: 'postgresql://letitbe:secret@127.0.0.1:15432/letitbe',
      }),
    ).toEqual({
      adminDatabaseUrl: 'postgresql://letitbe:secret@127.0.0.1:15432/postgres',
      testDatabaseUrl: 'postgresql://letitbe:secret@127.0.0.1:15432/letitbe_test',
      testDatabaseName: 'letitbe_test',
      provision: true,
    });
  });

  it('uses an explicit isolated test database without provisioning it', () => {
    expect(
      resolveIntegrationDatabaseUrls({
        DATABASE_URL: 'postgresql://user:secret@db.example.com/app',
        TEST_DATABASE_URL: 'postgresql://user:secret@db.example.com/app_ci',
      }),
    ).toMatchObject({
      testDatabaseUrl: 'postgresql://user:secret@db.example.com/app_ci',
      testDatabaseName: 'app_ci',
      provision: false,
    });
  });

  it('rejects an explicit test URL that points at the development database', () => {
    expect(() =>
      resolveIntegrationDatabaseUrls({
        DATABASE_URL: 'postgresql://user:secret@db.example.com/app',
        TEST_DATABASE_URL: 'postgresql://user:secret@db.example.com/app',
      }),
    ).toThrow('TEST_DATABASE_URL must not point to the development database.');
  });

  it('recognizes the same database across credentials, protocol aliases, and default ports', () => {
    expect(() =>
      resolveIntegrationDatabaseUrls({
        DATABASE_URL: 'postgresql://developer:secret@db.example.com:5432/app',
        TEST_DATABASE_URL: 'postgres://test-runner:other-secret@db.example.com/app',
      }),
    ).toThrow('TEST_DATABASE_URL must not point to the development database.');
  });
});
