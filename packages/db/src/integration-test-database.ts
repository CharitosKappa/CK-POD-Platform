export type IntegrationDatabaseEnvironment = Readonly<{
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  INTEGRATION_TEST_DATABASE?: string;
}>;

export type IntegrationDatabaseUrls = Readonly<{
  adminDatabaseUrl: string;
  testDatabaseUrl: string;
  testDatabaseName: string;
  provision: boolean;
}>;

export function integrationTestDatabaseUrl(
  environment: IntegrationDatabaseEnvironment,
): string | undefined {
  if (environment.INTEGRATION_TEST_DATABASE !== '1') return undefined;
  return environment.DATABASE_URL?.trim() || undefined;
}

export function resolveIntegrationDatabaseUrls(
  environment: IntegrationDatabaseEnvironment,
): IntegrationDatabaseUrls {
  const developmentValue = environment.DATABASE_URL?.trim();
  const explicitTestValue = environment.TEST_DATABASE_URL?.trim();
  if (!developmentValue && !explicitTestValue)
    throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for integration tests.');

  const development = developmentValue ? databaseUrl(developmentValue) : null;
  const explicitTest = explicitTestValue ? databaseUrl(explicitTestValue) : null;
  if (development && explicitTest && sameDatabase(development, explicitTest))
    throw new Error('TEST_DATABASE_URL must not point to the development database.');

  const test = explicitTest ?? deriveTestDatabase(development!);
  const admin = new URL(test);
  admin.pathname = '/postgres';
  return {
    adminDatabaseUrl: admin.toString(),
    testDatabaseUrl: test.toString(),
    testDatabaseName: databaseName(test),
    provision: !explicitTest,
  };
}

function databaseUrl(value: string) {
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !databaseName(parsed))
    throw new Error('Enter a valid PostgreSQL database URL for integration tests.');
  return parsed;
}

function deriveTestDatabase(development: URL) {
  const derived = new URL(development);
  derived.pathname = `/${encodeURIComponent(`${databaseName(development)}_test`)}`;
  return derived;
}

function databaseName(value: URL) {
  return decodeURIComponent(value.pathname.replace(/^\//, ''));
}

function sameDatabase(left: URL, right: URL) {
  return (
    left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
    effectivePostgresPort(left) === effectivePostgresPort(right) &&
    databaseName(left) === databaseName(right)
  );
}

function effectivePostgresPort(value: URL) {
  return value.port || '5432';
}
