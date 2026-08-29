import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseServerEnvironment } from '@let-it-be/config';
import { createDatabaseClient } from '@let-it-be/db';
import { CatalogSyncService, createFulfillmentAdapter } from '@let-it-be/domain';

async function main(): Promise<void> {
  await loadLocalEnvironment();
  const environment = parseServerEnvironment(process.env);
  const database = createDatabaseClient(environment.DATABASE_URL);
  const adapter = createFulfillmentAdapter({
    adapter: environment.FULFILLMENT_ADAPTER,
    baseUrl: environment.PRINTIFY_API_BASE_URL,
    ...(environment.PRINTIFY_API_TOKEN ? { apiToken: environment.PRINTIFY_API_TOKEN } : {}),
    ...(environment.PRINTIFY_SHOP_ID ? { shopId: environment.PRINTIFY_SHOP_ID } : {}),
    ...(environment.PRINTIFY_WEBHOOK_SECRET
      ? { webhookSecret: environment.PRINTIFY_WEBHOOK_SECRET }
      : {}),
  });
  try {
    const summary = await new CatalogSyncService(database.pool, adapter).sync(
      `reconcile:${environment.FULFILLMENT_ADAPTER}:${new Date().toISOString().slice(0, 10)}`,
    );
    console.info('Fulfillment catalog reconciliation completed.', summary);
  } finally {
    await database.close();
  }
}

async function loadLocalEnvironment(): Promise<void> {
  try {
    const path = fileURLToPath(new URL('../.env', import.meta.url));
    const contents = await readFile(path, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2];
    }
  } catch {
    // Explicit shell environment remains supported when no local .env exists.
  }
}

void main();
