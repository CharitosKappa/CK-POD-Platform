import { spawn } from 'node:child_process';

import { createDatabaseClient } from '../packages/db/src/index';
import { resolveIntegrationDatabaseUrls } from '../packages/db/src/integration-test-database';

const integrationTests = [
  'packages/db/src/order-edit-payment-migrations.integration.test.ts',
  'packages/domain/src/identity-projects.integration.test.ts',
  'packages/domain/src/generation.integration.test.ts',
  'packages/domain/src/prepress.integration.test.ts',
  'packages/domain/src/styles.integration.test.ts',
  'packages/domain/src/fulfillment-routing.integration.test.ts',
  'packages/domain/src/commerce.integration.test.ts',
  'packages/domain/src/operations-analytics.integration.test.ts',
  'packages/domain/src/privacy-lifecycle.integration.test.ts',
  'packages/domain/src/customer-exports.integration.test.ts',
  'packages/domain/src/customer-reconciliation.integration.test.ts',
  'packages/domain/src/customer-addresses.integration.test.ts',
  'packages/domain/src/customer-consent.integration.test.ts',
  'packages/domain/src/store-credit.integration.test.ts',
  'packages/domain/src/order-detail.integration.test.ts',
  'packages/domain/src/order-admin-actions.integration.test.ts',
  'apps/web/app/api/admin/orders/[orderNumber]/_actions/actions.integration.test.ts',
];

async function main() {
  const resolved = resolveIntegrationDatabaseUrls(process.env);
  if (resolved.provision)
    await ensureDatabaseExists(resolved.adminDatabaseUrl, resolved.testDatabaseName);

  const environment = {
    ...process.env,
    DATABASE_URL: resolved.testDatabaseUrl,
    INTEGRATION_TEST_DATABASE: '1',
  };
  console.info(`Integration database: ${safeDatabaseLabel(resolved.testDatabaseUrl)}`);
  await runPnpm(['--filter', '@let-it-be/db', 'migrate'], environment);
  await runPnpm(
    ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...integrationTests],
    environment,
  );
}

async function ensureDatabaseExists(adminUrl: string, databaseName: string) {
  const database = createDatabaseClient(adminUrl);
  try {
    const existing = await database.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS exists`,
      [databaseName],
    );
    if (existing.rows[0]?.exists) return;
    await database.pool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
    console.info(`Created isolated integration database ${databaseName}.`);
  } finally {
    await database.close();
  }
}

function runPnpm(arguments_: string[], environment: NodeJS.ProcessEnv) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const commandArguments =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...arguments_] : arguments_;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArguments, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Integration command failed (${signal ?? code ?? 'unknown status'}).`));
    });
  });
}

function safeDatabaseLabel(value: string) {
  const url = new URL(value);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
